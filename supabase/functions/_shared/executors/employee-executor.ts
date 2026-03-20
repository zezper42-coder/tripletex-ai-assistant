// Employee creation executor — deterministic, no LLM in execution path

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { validateEmployeeFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

// TODO: Tripletex role assignment may require separate API calls after employee creation.
// The Tripletex API v2 has /v2/employee/{id}/entitlement for role/permission management.
// Need to confirm exact behavior for:
//   - "administrator" role
//   - "account administrator" role
//   - standard employee (no special role)
// For now, we capture the role in fields but don't attempt to assign it via API.

export async function executeEmployeeCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:employee");
  const fields = parsed.fields;

  // Normalize field names — handle split or combined name formats
  let firstName = (fields.firstName ?? fields.fornavn) as string | undefined;
  let lastName = (fields.lastName ?? fields.etternavn ?? fields.surname) as string | undefined;

  // If only "name" is present, try to split it
  if (!firstName && !lastName && fields.name) {
    const parts = String(fields.name).trim().split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(" ") || parts[0]; // Tripletex requires lastName
  }

  const email = (fields.email ?? fields.emailAddress ?? fields.epost) as string | undefined;
  const phone = (fields.phoneNumberMobile ?? fields.phone ?? fields.telefon ?? fields.mobil) as string | undefined;
  const role = (fields.role ?? fields.stilling ?? fields.jobTitle ?? fields.stillingstittel) as string | undefined;
  const dateOfBirth = (fields.dateOfBirth ?? fields.fødselsdato) as string | undefined;

  const normalizedFields: Record<string, unknown> = {
    firstName,
    lastName,
    ...(email && { email: email.trim() }),
    ...(phone && { phoneNumberMobile: String(phone).trim() }),
    ...(dateOfBirth && { dateOfBirth }),
  };

  // Validate before calling API
  const errors = validateEmployeeFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, log);
  }

  const body: Record<string, unknown> = {
    firstName: normalizedFields.firstName,
    lastName: normalizedFields.lastName,
    ...(normalizedFields.email && { email: normalizedFields.email }),
    ...(normalizedFields.phoneNumberMobile && { phoneNumberMobile: normalizedFields.phoneNumberMobile }),
    ...(normalizedFields.dateOfBirth && { dateOfBirth: normalizedFields.dateOfBirth }),
  };

  const plan: ExecutionPlan = {
    summary: `Create employee: ${firstName} ${lastName}`,
    steps: [
      {
        stepNumber: 1,
        description: `POST /v2/employee — create "${firstName} ${lastName}"`,
        method: "POST",
        endpoint: "/v2/employee",
        body,
        resultKey: "employeeId",
      },
    ],
  };

  // TODO: If role is "administrator" or "kontoadministrator", add a step 2 for role assignment
  // via POST /v2/employee/{id}/entitlement or similar endpoint.
  if (role) {
    log.info(`Role detected: "${role}" — stored but not yet assigned via API (TODO)`);
    plan.summary += ` (role: ${role})`;
  }

  log.info("Executing employee creation", { body, role });
  const start = Date.now();

  const response = await client.post("/v2/employee", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  const stepResult: StepResult = {
    stepNumber: 1,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(!success && { error: `Tripletex returned ${response.status}` }),
  };

  // Verify creation if successful
  let verified = false;
  if (success) {
    const id = extractId(response.data);
    if (id) {
      log.info(`Employee created with ID ${id}, verifying...`);
      try {
        const check = await client.get(`/v2/employee/${id}`);
        verified = check.status === 200;
        log.info(`Verification: ${verified ? "passed" : "failed"}`);
      } catch (err) {
        log.warn("Verification request failed", { error: String(err) });
      }
    }
  }

  return {
    plan,
    stepResults: [stepResult],
    verified,
  };
}

function extractId(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (d.value && typeof d.value === "object") {
    const v = d.value as Record<string, unknown>;
    if (typeof v.id === "number") return v.id;
  }
  if (typeof d.id === "number") return d.id;
  return undefined;
}

function failedResult(errors: ValidationError[], logger: Logger): ExecutorResult {
  const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
  logger.error("Employee creation aborted due to validation errors");
  return {
    plan: { summary: "Employee creation failed: validation errors", steps: [] },
    stepResults: [{
      stepNumber: 0,
      success: false,
      statusCode: 0,
      error: errorMsg,
      duration: 0,
    }],
    verified: false,
  };
}
