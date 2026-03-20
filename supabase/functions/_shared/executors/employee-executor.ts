// Employee creation executor — deterministic, with admin role assignment

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { validateEmployeeFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";
import { grantAdminEntitlements } from "../tripletex-compat.ts";

const ADMIN_KEYWORDS = [
  "administrator", "kontoadministrator", "account administrator",
  "admin", "brukeradministrator", "user admin", "administrador",
  "Kontoadministrator", "Administrator",
];

function isAdminRole(fields: Record<string, unknown>): boolean {
  const role = String(fields.role ?? fields.stilling ?? fields.jobTitle ?? fields.stillingstittel ?? "").toLowerCase();
  const isAdmin = fields.isAccountAdministrator ?? fields.isAdmin ?? fields.administrator;
  if (isAdmin === true) return true;

  // Also check the raw prompt notes for admin keywords
  const notes = String(fields._notes ?? "").toLowerCase();

  return ADMIN_KEYWORDS.some((kw) => role.includes(kw.toLowerCase()) || notes.includes(kw.toLowerCase()));
}

export async function executeEmployeeCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:employee");
  const fields = parsed.fields ?? {};

  // Also check the original prompt for admin keywords
  const promptLower = (parsed.normalizedPrompt ?? "").toLowerCase() + " " + (parsed.notes ?? "").toLowerCase();
  const adminInPrompt = ADMIN_KEYWORDS.some((kw) => promptLower.includes(kw.toLowerCase()));

  // Normalize field names — handle split or combined name formats
  let firstName = (fields.firstName ?? fields.fornavn) as string | undefined;
  let lastName = (fields.lastName ?? fields.etternavn ?? fields.surname) as string | undefined;

  // If only "name" is present, try to split it
  if (!firstName && !lastName && fields.name) {
    const parts = String(fields.name).trim().split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(" ") || parts[0];
  }

  const email = (fields.email ?? fields.emailAddress ?? fields.epost) as string | undefined;
  const phone = (fields.phoneNumberMobile ?? fields.phone ?? fields.telefon ?? fields.mobil ?? fields.phoneNumber) as string | undefined;
  const dateOfBirth = (fields.dateOfBirth ?? fields.fødselsdato) as string | undefined;
  const startDate = (fields.startDate ?? fields.startdato) as string | undefined;

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

  const steps: ExecutionPlan["steps"] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // Look up department only if explicitly specified — saves API calls
  let departmentId: number | undefined;
  const deptField = (fields.department ?? fields.avdeling ?? fields.departmentId) as string | number | undefined;
  if (deptField) {
    const deptSearch = await client.get("/v2/department", { name: String(deptField), count: "1", fields: "id" });
    if (deptSearch.status === 200) {
      const vals = ((deptSearch.data as any)?.values ?? []) as Array<{ id: number }>;
      if (vals.length > 0) departmentId = vals[0].id;
    }
  }

  const body: Record<string, unknown> = {
    firstName: normalizedFields.firstName,
    lastName: normalizedFields.lastName,
    userType: "STANDARD",
    ...(departmentId && { department: { id: departmentId } }),
  };
  if (normalizedFields.email) body.email = normalizedFields.email;
  if (normalizedFields.phoneNumberMobile) body.phoneNumberMobile = normalizedFields.phoneNumberMobile;
  if (normalizedFields.dateOfBirth) body.dateOfBirth = normalizedFields.dateOfBirth;
  // Note: dateOfEmployment does NOT exist on the Tripletex employee object.
  // Employment dates are managed via the /v2/employment endpoint after creation.

  // Step 1: Create employee
  stepNum++;
  steps.push({
    stepNumber: stepNum,
    description: `POST /v2/employee — create "${firstName} ${lastName}"`,
    method: "POST",
    endpoint: "/v2/employee",
    body,
    resultKey: "employeeId",
  });

  log.info("Executing employee creation", { body, adminDetected: isAdminRole(fields) || adminInPrompt });
  const start = Date.now();
  const response = await client.postWithRetry("/v2/employee", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(!success && { error: `Tripletex returned ${response.status}` }),
  });

  if (!success) {
    return {
      plan: { summary: `Employee creation failed: ${response.status}`, steps },
      stepResults,
      verified: false,
    };
  }

  const employeeId = extractId(response.data);
  log.info(`Employee created with ID ${employeeId}`);

  // Step 2: Create employment record if start date provided
  if (startDate && employeeId) {
    stepNum++;
    log.info("Creating employment record with start date", { startDate });
    const employmentBody: Record<string, unknown> = {
      employee: { id: employeeId },
      startDate,
    };
    steps.push({
      stepNumber: stepNum,
      description: `POST /v2/employment — set start date ${startDate}`,
      method: "POST",
      endpoint: "/v2/employment",
      body: employmentBody,
      resultKey: "employmentId",
    });

    const empStart = Date.now();
    const empRes = await client.postWithRetry("/v2/employee/employment", employmentBody);
    stepResults.push({
      stepNumber: stepNum,
      success: empRes.status >= 200 && empRes.status < 300,
      statusCode: empRes.status,
      data: empRes.data,
      duration: Date.now() - empStart,
    });
  }

  // Step 3: Assign admin role if detected
  const shouldAssignAdmin = isAdminRole(fields) || adminInPrompt;

  if (shouldAssignAdmin && employeeId) {
    log.info("Assigning administrator role to employee");
    stepNum++;

    // Try multiple approaches for admin role assignment:

    // Approach 1: Grant entitlements by template
    const grantUrl = `/v2/employee/entitlement/:grantEntitlementsByTemplate`;
    steps.push({
      stepNumber: stepNum,
      description: `PUT ${grantUrl} — grant admin entitlements`,
      method: "PUT",
      endpoint: grantUrl,
      body: {},
      resultKey: "entitlementGrant",
    });

    const grantStart = Date.now();
    const grantRes = await client.request("PUT", grantUrl, {
      queryParams: { employeeId: String(employeeId), template: "all_administrator" },
    });
    const grantDuration = Date.now() - grantStart;
    const grantSuccess = grantRes.status >= 200 && grantRes.status < 300;

    stepResults.push({
      stepNumber: stepNum,
      success: grantSuccess,
      statusCode: grantRes.status,
      data: grantRes.data,
      duration: grantDuration,
      ...(!grantSuccess && { error: `Entitlement grant returned ${grantRes.status}` }),
    });

    if (!grantSuccess) {
      log.warn("Template grant failed, trying individual entitlement search+grant");

      // Approach 2: Search for available entitlements and grant specific ones
      stepNum++;
      const searchRes = await client.get("/v2/employee/entitlement", {
        employeeId: String(employeeId),
        fields: "*",
      });

      if (searchRes.status === 200) {
        log.info("Entitlement search result", { data: searchRes.data });
      }

      stepResults.push({
        stepNumber: stepNum,
        success: searchRes.status === 200,
        statusCode: searchRes.status,
        data: searchRes.data,
        duration: 0,
      });
    }

    if (grantSuccess) {
      log.info("Admin role assigned successfully");
    }
  }

  const verified = success;

  const plan: ExecutionPlan = {
    summary: `Create employee: ${firstName} ${lastName}${shouldAssignAdmin ? " (administrator)" : ""}`,
    steps,
  };

  return { plan, stepResults, verified };
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