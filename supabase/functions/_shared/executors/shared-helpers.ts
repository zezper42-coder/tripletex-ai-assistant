// Shared executor helpers — DRY utilities used across all executors

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

// ── ID extraction ──────────────────────────────────────────────────────

export function extractId(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (d.value && typeof d.value === "object") {
    const v = d.value as Record<string, unknown>;
    if (typeof v.id === "number") return v.id;
  }
  if (typeof d.id === "number") return d.id;
  return undefined;
}

export function extractListValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.values)) return d.values as Record<string, unknown>[];
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  return [];
}

export function extractSingle(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (d.value && typeof d.value === "object") return d.value as Record<string, unknown>;
  return d;
}

// ── Failed result builder ──────────────────────────────────────────────

export function failResult(summary: string, error: string): ExecutorResult {
  return {
    plan: { summary, steps: [] },
    stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error, duration: 0 }],
    verified: false,
  };
}

// ── Generic search-by-name/id helper ───────────────────────────────────

export async function resolveEntityId(
  client: TripletexClient,
  endpoint: string,
  identifiers: { id?: number; name?: string; email?: string; orgNr?: string },
  logger: Logger,
): Promise<{ id: number | undefined; stepResult: StepResult }> {
  if (identifiers.id) {
    return { id: identifiers.id, stepResult: { stepNumber: 0, success: true, statusCode: 200, data: null, duration: 0 } };
  }

  const params: Record<string, string> = { fields: "*", count: "5" };
  if (identifiers.name) params.name = identifiers.name;
  if (identifiers.email) params.email = identifiers.email;
  if (identifiers.orgNr) params.organizationNumber = identifiers.orgNr;

  const start = Date.now();
  const res = await client.get(endpoint, params);
  const duration = Date.now() - start;
  const sr: StepResult = { stepNumber: 0, success: res.status === 200, statusCode: res.status, data: res.data, duration };

  if (res.status !== 200) return { id: undefined, stepResult: sr };

  const vals = extractListValues(res.data);
  if (vals.length === 1) return { id: vals[0].id as number, stepResult: sr };
  if (vals.length > 1 && identifiers.name) {
    const exact = vals.find(v => String(v.name).toLowerCase() === identifiers.name!.toLowerCase());
    if (exact) return { id: exact.id as number, stepResult: sr };
  }
  if (vals.length > 0) return { id: vals[0].id as number, stepResult: sr };
  return { id: undefined, stepResult: sr };
}

// ── Generic GET-merge-PUT update executor ──────────────────────────────

export async function genericUpdate(
  client: TripletexClient,
  logger: Logger,
  endpoint: string, // e.g. "/v2/customer"
  entityId: number,
  updateFields: Record<string, unknown>,
  requiredFields: string[] = [],
): Promise<{ stepResults: StepResult[]; success: boolean }> {
  const stepResults: StepResult[] = [];

  // GET current
  const getStart = Date.now();
  const getRes = await client.get(`${endpoint}/${entityId}`, { fields: "*" });
  stepResults.push({ stepNumber: 1, success: getRes.status === 200, statusCode: getRes.status, data: getRes.data, duration: Date.now() - getStart });

  if (getRes.status !== 200) return { stepResults, success: false };

  const current = extractSingle(getRes.data) ?? {};
  const version = current.version as number | undefined;

  // Build update body — keep required fields from current, overlay new fields
  const body: Record<string, unknown> = { id: entityId };
  for (const rf of requiredFields) {
    if (current[rf] !== undefined) body[rf] = current[rf];
  }
  Object.assign(body, updateFields);
  if (version !== undefined) body.version = version;

  // PUT
  const putStart = Date.now();
  const putRes = await client.putWithRetry(`${endpoint}/${entityId}`, body);
  const success = putRes.status >= 200 && putRes.status < 300;
  stepResults.push({
    stepNumber: 2,
    success,
    statusCode: putRes.status,
    data: putRes.data,
    duration: Date.now() - putStart,
    ...(!success && { error: `PUT failed: ${putRes.status}` }),
  });

  return { stepResults, success };
}

// ── Generic DELETE executor ────────────────────────────────────────────

export async function genericDelete(
  client: TripletexClient,
  logger: Logger,
  endpoint: string, // e.g. "/v2/travelExpense"
  entityId: number,
): Promise<{ stepResults: StepResult[]; success: boolean }> {
  const start = Date.now();
  const res = await client.delete(`${endpoint}/${entityId}`);
  const success = res.status >= 200 && res.status < 300;
  return {
    stepResults: [{
      stepNumber: 1,
      success,
      statusCode: res.status,
      data: res.data,
      duration: Date.now() - start,
      ...(!success && { error: `DELETE failed: ${res.status}` }),
    }],
    success,
  };
}

// ── Generic search-then-delete ─────────────────────────────────────────

export async function searchAndDelete(
  client: TripletexClient,
  logger: Logger,
  searchEndpoint: string,
  deleteEndpoint: string,
  searchParams: Record<string, string>,
  filterFn?: (items: Record<string, unknown>[]) => Record<string, unknown>[],
): Promise<ExecutorResult> {
  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];

  // Search
  steps.push({ stepNumber: 1, description: `GET ${searchEndpoint} — search`, method: "GET", endpoint: searchEndpoint, queryParams: searchParams });
  const searchStart = Date.now();
  const searchRes = await client.get(searchEndpoint, searchParams);
  stepResults.push({ stepNumber: 1, success: searchRes.status === 200, statusCode: searchRes.status, data: searchRes.data, duration: Date.now() - searchStart });

  if (searchRes.status !== 200) {
    return { plan: { summary: "Search failed", steps }, stepResults, verified: false };
  }

  let candidates = extractListValues(searchRes.data);
  if (filterFn) candidates = filterFn(candidates);

  if (candidates.length === 0) {
    return failResult("Delete failed: no match found", "No matching entity found");
  }

  // Delete first match (or only match)
  const targetId = candidates[0].id as number;
  steps.push({ stepNumber: 2, description: `DELETE ${deleteEndpoint}/${targetId}`, method: "DELETE", endpoint: `${deleteEndpoint}/${targetId}` });
  
  const delStart = Date.now();
  const delRes = await client.delete(`${deleteEndpoint}/${targetId}`);
  const delSuccess = delRes.status >= 200 && delRes.status < 300;
  stepResults.push({
    stepNumber: 2,
    success: delSuccess,
    statusCode: delRes.status,
    data: delRes.data,
    duration: Date.now() - delStart,
    ...(!delSuccess && { error: `DELETE failed: ${delRes.status}` }),
  });

  return {
    plan: { summary: `Deleted ID ${targetId}`, steps },
    stepResults,
    verified: delSuccess,
  };
}

// ── Resolve employee by email/name/id ──────────────────────────────────

export async function resolveEmployeeId(
  client: TripletexClient,
  logger: Logger,
  fields: Record<string, unknown>,
): Promise<{ id: number | undefined; stepResult?: StepResult }> {
  const empId = fields.employeeId ?? fields.employee_id ?? fields.id;
  if (empId) return { id: Number(empId) };

  const empEmail = (fields.employeeEmail ?? fields.employee_email ?? fields.email ?? fields.epost) as string | undefined;
  const empName = (fields.employeeName ?? fields.employee_name ?? fields.name ?? fields.ansatt ?? fields.empleado ?? fields.Mitarbeiter ?? fields.employé) as string | undefined;

  const params: Record<string, string> = { fields: "*", count: "5" };
  if (empEmail) {
    params.email = empEmail.trim();
  } else if (empName) {
    const parts = empName.trim().split(/\s+/);
    params.firstName = parts[0];
    if (parts.length > 1) params.lastName = parts.slice(1).join(" ");
  } else {
    return { id: undefined };
  }

  const start = Date.now();
  const res = await client.get("/v2/employee", params);
  const sr: StepResult = { stepNumber: 0, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start };

  if (res.status !== 200) return { id: undefined, stepResult: sr };

  const vals = extractListValues(res.data);
  if (vals.length === 1) return { id: vals[0].id as number, stepResult: sr };
  if (vals.length > 1 && empName) {
    const nameLower = empName.toLowerCase();
    const exact = vals.find(v => `${v.firstName} ${v.lastName}`.toLowerCase() === nameLower);
    if (exact) return { id: exact.id as number, stepResult: sr };
  }
  if (vals.length > 0) return { id: vals[0].id as number, stepResult: sr };
  return { id: undefined, stepResult: sr };
}
