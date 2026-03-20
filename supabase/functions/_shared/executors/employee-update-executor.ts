// Employee update executor — GET + merge + PUT with version

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { grantAdminEntitlements } from "../tripletex-compat.ts";

export async function executeEmployeeUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:employee_update");
  const f = parsed.fields ?? {};

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // Resolve employee
  let employeeId = (f.id ?? f.employeeId ?? f.employee_id) as number | undefined;
  const empEmail = (f.email ?? f.epost ?? f.employeeEmail) as string | undefined;
  const empName = (f.name ?? f.employeeName ?? f.ansatt) as string | undefined;

  if (!employeeId && (empEmail || empName)) {
    stepNum++;
    const params: Record<string, string> = { fields: "*", count: "5" };
    if (empEmail) params.email = empEmail;
    else if (empName) {
      const parts = String(empName).trim().split(/\s+/);
      params.firstName = parts[0];
      if (parts.length > 1) params.lastName = parts.slice(1).join(" ");
    }

    const searchRes = await client.get("/v2/employee", params);
    stepResults.push({ stepNumber: stepNum, success: searchRes.status === 200, statusCode: searchRes.status, data: searchRes.data, duration: 0 });

    if (searchRes.status === 200) {
      const vals = ((searchRes.data as any)?.values ?? []) as Record<string, unknown>[];
      if (vals.length === 1) employeeId = vals[0].id as number;
      else if (vals.length > 1 && empName) {
        const nameLower = empName.toLowerCase();
        const exact = vals.find(v => `${v.firstName} ${v.lastName}`.toLowerCase() === nameLower);
        if (exact) employeeId = exact.id as number;
      }
    }
  }

  if (!employeeId) {
    return {
      plan: { summary: "Employee update failed: could not resolve employee", steps },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: "No employee found", duration: 0 }],
      verified: false,
    };
  }

  // GET current state
  stepNum++;
  const getRes = await client.get(`/v2/employee/${employeeId}`, { fields: "*" });
  stepResults.push({ stepNumber: stepNum, success: getRes.status === 200, statusCode: getRes.status, data: getRes.data, duration: 0 });

  if (getRes.status !== 200) {
    return { plan: { summary: "Employee update failed: GET failed", steps }, stepResults, verified: false };
  }

  const current = ((getRes.data as any)?.value ?? getRes.data) as Record<string, unknown>;
  const version = current.version as number | undefined;

  // Build update body with minimal required fields to avoid 422
  const updateBody: Record<string, unknown> = {
    id: employeeId,
    firstName: current.firstName,
    lastName: current.lastName,
  };
  const newEmail = (f.newEmail ?? f.email ?? f.epost) as string | undefined;
  const newPhone = (f.phoneNumberMobile ?? f.phone ?? f.telefon ?? f.mobil ?? f.newPhone) as string | undefined;
  const newFirstName = (f.firstName ?? f.fornavn ?? f.newFirstName) as string | undefined;
  const newLastName = (f.lastName ?? f.etternavn ?? f.newLastName) as string | undefined;
  const newDateOfBirth = (f.dateOfBirth ?? f.fødselsdato) as string | undefined;

  if (newEmail) updateBody.email = newEmail.trim();
  if (newPhone) updateBody.phoneNumberMobile = String(newPhone).trim();
  if (newFirstName) updateBody.firstName = newFirstName;
  if (newLastName) updateBody.lastName = newLastName;
  if (newDateOfBirth) updateBody.dateOfBirth = newDateOfBirth;
  if (version !== undefined) updateBody.version = version;

  // PUT
  stepNum++;
  steps.push({
    stepNumber: stepNum,
    description: `PUT /v2/employee/${employeeId} — update`,
    method: "PUT",
    endpoint: `/v2/employee/${employeeId}`,
    body: updateBody,
    resultKey: "updatedEmployee",
  });

  log.info("Updating employee", { employeeId });
  const start = Date.now();
  const putRes = await client.putWithRetry(`/v2/employee/${employeeId}`, updateBody);
  const duration = Date.now() - start;
  const success = putRes.status >= 200 && putRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success,
    statusCode: putRes.status,
    data: putRes.data,
    duration,
    ...(!success && { error: `Update failed: ${putRes.status}` }),
  });

  if (!success) {
    return { plan: { summary: `Employee ${employeeId} update failed`, steps }, stepResults, verified: false };
  }

  // ── Admin role assignment ──
  const ADMIN_KEYWORDS = [
    "administrator", "kontoadministrator", "account administrator",
    "admin", "brukeradministrator", "administrador", "Kontoadministrator",
  ];
  const promptLower = (parsed.normalizedPrompt ?? "").toLowerCase() + " " + (parsed.notes ?? "").toLowerCase();
  const isAdmin = (f.isAccountAdministrator === true) || (f.isAdmin === true) ||
    ADMIN_KEYWORDS.some(kw => promptLower.includes(kw.toLowerCase())) ||
    ADMIN_KEYWORDS.some(kw => String(f.role ?? f.stilling ?? "").toLowerCase().includes(kw.toLowerCase()));

  if (isAdmin) {
    stepNum++;
    log.info("Assigning administrator role to employee");
    steps.push({
      stepNumber: stepNum,
      description: "Grant admin entitlements (userType EXTENDED + template)",
      method: "PUT",
      endpoint: "/v2/employee/entitlement/:grantEntitlementsByTemplate",
      body: {},
      resultKey: "entitlementGrant",
    });

    const grantResult = await grantAdminEntitlements(client, log, employeeId);
    stepResults.push({
      stepNumber: stepNum,
      success: grantResult.success,
      statusCode: grantResult.status,
      data: grantResult.data,
      duration: 0,
      ...(!grantResult.success && { error: "All entitlement templates failed" }),
    });
  }

  return {
    plan: { summary: `Employee ${employeeId} updated${isAdmin ? " (admin role assigned)" : ""}`, steps },
    stepResults,
    verified: success,
  };
}
