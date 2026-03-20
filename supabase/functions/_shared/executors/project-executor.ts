// Project creation executor — deterministic, with optional customer lookup

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { validateProjectFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeProjectCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:project");
  const f = parsed.fields;

  const name = (f.name ?? f.projectName ?? f.prosjektnavn ?? f.nombre ?? f.Projektname) as string | undefined;
  const projectNumber = (f.number ?? f.projectNumber ?? f.prosjektnummer) as string | undefined;
  const description = (f.description ?? f.beskrivelse ?? f.descripcion) as string | undefined;
  const customerRef = (f.customer ?? f.customerName ?? f.kunde ?? f.kundenavn ?? f.cliente) as string | undefined;
  // TODO: projectManagerId may be required by Tripletex — need to confirm and potentially look up or default

  const normalizedFields: Record<string, unknown> = {
    name,
    ...(projectNumber && { number: String(projectNumber).trim() }),
    ...(description && { description: String(description).trim() }),
    ...(customerRef && { customerRef: String(customerRef).trim() }),
  };

  const errors = validateProjectFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, log);
  }

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let customerId: number | undefined;

  // If customer referenced, search for exact match
  if (customerRef) {
    steps.push({
      stepNumber: 1,
      description: `GET /v2/customer — search for "${customerRef}"`,
      method: "GET",
      endpoint: "/v2/customer",
      queryParams: { name: customerRef },
      resultKey: "customerSearchResult",
    });

    log.info("Searching for customer", { customerRef });
    const start = Date.now();
    const searchResp = await client.get("/v2/customer", { name: customerRef });
    const duration = Date.now() - start;

    const searchSuccess = searchResp.status >= 200 && searchResp.status < 300;
    stepResults.push({
      stepNumber: 1,
      success: searchSuccess,
      statusCode: searchResp.status,
      data: searchResp.data,
      duration,
    });

    if (searchSuccess) {
      const customers = extractListValues(searchResp.data);
      if (customers.length === 1) {
        customerId = customers[0].id as number;
        log.info(`Found customer ID ${customerId}`);
      } else if (customers.length === 0) {
        log.warn("Customer not found, project will be created without customer link");
        // Don't fail — create project without customer
      } else {
        log.warn(`Ambiguous customer search: ${customers.length} results`);
        // Use first exact match if available
        const exact = customers.find(
          (c: Record<string, unknown>) =>
            String(c.name).toLowerCase() === customerRef.toLowerCase()
        );
        if (exact) {
          customerId = exact.id as number;
          log.info(`Using exact match customer ID ${customerId}`);
        }
      }
    }
  }

  const body: Record<string, unknown> = {
    name: normalizedFields.name,
    // TODO: projectManagerId may be required — Tripletex might reject without it
    ...(normalizedFields.number && { number: normalizedFields.number }),
    ...(normalizedFields.description && { description: normalizedFields.description }),
    ...(customerId && { customer: { id: customerId } }),
  };

  const createStepNumber = customerRef ? 2 : 1;
  steps.push({
    stepNumber: createStepNumber,
    description: `POST /v2/project — create "${normalizedFields.name}"`,
    method: "POST",
    endpoint: "/v2/project",
    body,
    resultKey: "projectId",
  });

  const plan: ExecutionPlan = {
    summary: `Create project: ${normalizedFields.name}${customerId ? ` (linked to customer ${customerId})` : ""}`,
    steps,
  };

  log.info("Executing project creation", { body });
  const start = Date.now();
  const response = await client.post("/v2/project", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  stepResults.push({
    stepNumber: createStepNumber,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(!success && { error: `Tripletex returned ${response.status}` }),
  });

  let verified = false;
  if (success) {
    const id = extractId(response.data);
    if (id) {
      log.info(`Project created with ID ${id}, verifying...`);
      try {
        const check = await client.get(`/v2/project/${id}`);
        verified = check.status === 200;
        log.info(`Verification: ${verified ? "passed" : "failed"}`);
      } catch (err) {
        log.warn("Verification request failed", { error: String(err) });
      }
    }
  }

  return { plan, stepResults, verified };
}

function extractListValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.values)) return d.values as Record<string, unknown>[];
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  return [];
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
  logger.error("Project creation aborted due to validation errors");
  return {
    plan: { summary: "Project creation failed: validation errors", steps: [] },
    stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
    verified: false,
  };
}
