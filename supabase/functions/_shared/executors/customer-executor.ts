// Customer creation executor — deterministic, no LLM in execution path

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { validateCustomerFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeCustomerCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:customer");
  const fields = parsed.fields ?? {};

  // Normalize field names
  const name = (fields.name ?? fields.customerName ?? fields.companyName) as string | undefined;
  const email = (fields.email ?? fields.emailAddress) as string | undefined;
  const phone = (fields.phoneNumber ?? fields.phone ?? fields.telefon) as string | undefined;
  const orgNr = (fields.organizationNumber ?? fields.orgNumber ?? fields.organisasjonsnummer) as string | undefined;
  const invoiceEmail = (fields.invoiceEmail ?? fields.fakturaEpost) as string | undefined;

  const normalizedFields: Record<string, unknown> = {
    name,
    ...(email && { email: email.trim() }),
    ...(phone && { phoneNumber: String(phone).trim() }),
    ...(orgNr && { organizationNumber: String(orgNr).trim() }),
    ...(invoiceEmail && { invoiceEmail: invoiceEmail.trim() }),
  };

  // Validate before calling API
  const errors = validateCustomerFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, log);
  }

  const body: Record<string, unknown> = {
    name: normalizedFields.name,
    isCustomer: true,
    isSupplier: false,
  };
  if (normalizedFields.email) body.email = normalizedFields.email;
  if (normalizedFields.phoneNumber) body.phoneNumber = normalizedFields.phoneNumber;
  if (normalizedFields.organizationNumber) body.organizationNumber = normalizedFields.organizationNumber;
  if (normalizedFields.invoiceEmail) body.invoiceEmail = normalizedFields.invoiceEmail;

  const plan: ExecutionPlan = {
    summary: `Create customer: ${normalizedFields.name}`,
    steps: [
      {
        stepNumber: 1,
        description: `POST /v2/customer — create "${normalizedFields.name}"`,
        method: "POST",
        endpoint: "/v2/customer",
        body,
        resultKey: "customerId",
      },
    ],
  };

  log.info("Executing customer creation", { body });
  const start = Date.now();

  const response = await client.post("/v2/customer", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  const stepResult: StepResult = {
    stepNumber: 1,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(! success && { error: `Tripletex returned ${response.status}` }),
  };

  // Verify creation if successful
  let verified = false;
  if (success) {
    const id = extractId(response.data);
    if (id) {
      log.info(`Customer created with ID ${id}, verifying...`);
      try {
        const check = await client.get(`/v2/customer/${id}`);
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
  logger.error("Customer creation aborted due to validation errors");
  return {
    plan: { summary: "Customer creation failed: validation errors", steps: [] },
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
