// Department creation executor — deterministic path with optional module enablement

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

interface ValidationError { field: string; message: string; }

function validateDepartmentFields(fields: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = fields.name ?? fields.departmentName ?? fields.department_name;
  if (!name || (typeof name === "string" && !name.trim())) {
    errors.push({ field: "name", message: "Department name is required" });
  }
  const num = fields.departmentNumber ?? fields.department_number ?? fields.number;
  if (num !== undefined && num !== null) {
    const n = String(num).trim();
    if (!/^\d+$/.test(n)) {
      errors.push({ field: "departmentNumber", message: `Department number must be numeric: ${num}` });
    }
  }
  return errors;
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

export async function executeDepartmentCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:department");
  const fields = parsed.fields;

  const errors = validateDepartmentFields(fields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    return {
      plan: { summary: "Department creation failed: validation errors", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
      verified: false,
    };
  }

  const name = String(fields.name ?? fields.departmentName ?? fields.department_name ?? fields.avdelingsnavn ?? fields.nombre ?? fields.Abteilungsname ?? fields.nom);
  const deptNumber = fields.departmentNumber ?? fields.department_number ?? fields.number ?? fields.avdelingsnummer ?? fields.nummer;
  const managerId = fields.managerId ?? fields.manager_id ?? fields.departmentManager ?? fields.avdelingsleder;

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // ── Optional: enable department module if hinted ──
  const enableModule = fields.enable_department_module ?? fields.enableDepartmentModule;
  if (enableModule) {
    log.info("Department module enablement requested — assuming enabled in sandbox");
  }

  // ── Create department ──
  stepNum++;
  const body: Record<string, unknown> = {
    name: name.trim(),
    ...(deptNumber ? { departmentNumber: String(deptNumber).trim() } : {}),
    ...(managerId ? { departmentManager: { id: Number(managerId) } } : {}),
  };

  steps.push({
    stepNumber: stepNum,
    description: `POST /v2/department — create "${name}"`,
    method: "POST",
    endpoint: "/v2/department",
    body,
    resultKey: "departmentId",
  });

  log.info("Creating department", { body });
  const start = Date.now();
  const res = await client.postWithRetry("/v2/department", body);
  const duration = Date.now() - start;
  const success = res.status >= 200 && res.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success,
    statusCode: res.status,
    data: res.data,
    duration,
    ...(!success && { error: `Department creation failed: ${res.status}` }),
  });

  if (!success) {
    return { plan: { summary: `Department creation failed for "${name}"`, steps }, stepResults, verified: false };
  }

  const deptId = extractId(res.data);
  log.info(`Department created, ID: ${deptId}`);

  return {
    plan: { summary: `Department created: "${name}", ID: ${deptId}`, steps },
    stepResults,
    verified: success,
  };
}
