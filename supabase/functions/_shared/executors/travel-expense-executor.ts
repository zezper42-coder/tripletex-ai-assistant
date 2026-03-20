// Travel expense delete executor — search-then-delete with strict uniqueness

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { validateTravelExpenseDeleteFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeTravelExpenseDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:travelExpense");
  const f = parsed.fields;

  // Extract identifiers
  const expenseId = (f.id ?? f.expenseId ?? f.travelExpenseId) as number | string | undefined;
  const employeeName = (f.employee ?? f.employeeName ?? f.ansatt ?? f.funcionário ?? f.empleado) as string | undefined;
  const date = (f.date ?? f.dato ?? f.fecha ?? f.Datum) as string | undefined;
  const amount = (f.amount ?? f.beløp ?? f.beloep ?? f.monto ?? f.Betrag ?? f.montant) as number | string | undefined;
  const description = (f.description ?? f.beskrivelse ?? f.descripcion) as string | undefined;

  const identifiers: Record<string, unknown> = {
    ...(expenseId !== undefined && { id: Number(expenseId) }),
    ...(employeeName && { employeeName: String(employeeName).trim() }),
    ...(date && { date: String(date).trim() }),
    ...(amount !== undefined && { amount: Number(amount) }),
    ...(description && { description: String(description).trim() }),
  };

  const errors = validateTravelExpenseDeleteFields(identifiers);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, "Insufficient identifiers for safe deletion", log);
  }

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];

  // If direct ID provided, delete directly
  if (identifiers.id) {
    return await deleteById(Number(identifiers.id), client, log);
  }

  // Otherwise search with narrowest possible filters
  const queryParams: Record<string, string> = {};
  if (identifiers.employeeName) {
    queryParams.employeeFirstName = String(identifiers.employeeName).split(" ")[0] || "";
    const parts = String(identifiers.employeeName).split(" ");
    if (parts.length > 1) {
      queryParams.employeeLastName = parts.slice(1).join(" ");
    }
  }
  if (identifiers.date) {
    // Use date as both from and to for exact day match
    queryParams.departureDate = String(identifiers.date);
    // TODO: confirm Tripletex search parameter names for travelExpense date filtering
  }

  steps.push({
    stepNumber: 1,
    description: "GET /v2/travelExpense — search for matching expense",
    method: "GET",
    endpoint: "/v2/travelExpense",
    queryParams,
    resultKey: "searchResult",
  });

  log.info("Searching for travel expense", { queryParams });
  const searchStart = Date.now();
  const searchResp = await client.get("/v2/travelExpense", queryParams);
  const searchDuration = Date.now() - searchStart;

  const searchSuccess = searchResp.status >= 200 && searchResp.status < 300;
  stepResults.push({
    stepNumber: 1,
    success: searchSuccess,
    statusCode: searchResp.status,
    data: searchResp.data,
    duration: searchDuration,
  });

  if (!searchSuccess) {
    return {
      plan: { summary: "Travel expense search failed", steps },
      stepResults,
      verified: false,
    };
  }

  const expenses = extractListValues(searchResp.data);

  // Filter further by amount/description if available
  let candidates = expenses;
  if (identifiers.amount !== undefined) {
    const targetAmount = Number(identifiers.amount);
    candidates = candidates.filter((e) => {
      const amt = Number(e.amount ?? e.totalAmount ?? 0);
      return Math.abs(amt - targetAmount) < 0.01;
    });
  }
  if (identifiers.description) {
    const descLower = String(identifiers.description).toLowerCase();
    candidates = candidates.filter((e) =>
      String(e.title ?? e.description ?? "").toLowerCase().includes(descLower)
    );
  }

  if (candidates.length === 0) {
    log.warn("No matching travel expenses found");
    return failedResult([], "No matching travel expense found", log);
  }

  if (candidates.length > 1) {
    log.warn(`Ambiguous: ${candidates.length} matching travel expenses`);
    return {
      plan: {
        summary: `Travel expense deletion aborted: ${candidates.length} matches found (ambiguous)`,
        steps,
      },
      stepResults: [{
        stepNumber: 0,
        success: false,
        statusCode: 0,
        error: `Ambiguous deletion: found ${candidates.length} matching travel expenses. Provide more specific identifiers.`,
        duration: 0,
        data: { matchCount: candidates.length, matchIds: candidates.map((c) => c.id) },
      }],
      verified: false,
    };
  }

  // Exactly one match — safe to delete
  const targetId = candidates[0].id as number;
  log.info(`Found unique match, deleting travel expense ${targetId}`);

  steps.push({
    stepNumber: 2,
    description: `DELETE /v2/travelExpense/${targetId}`,
    method: "DELETE",
    endpoint: `/v2/travelExpense/${targetId}`,
    resultKey: "deleteResult",
  });

  const deleteStart = Date.now();
  const deleteResp = await client.delete(`/v2/travelExpense/${targetId}`);
  const deleteDuration = Date.now() - deleteStart;
  const deleteSuccess = deleteResp.status >= 200 && deleteResp.status < 300;

  stepResults.push({
    stepNumber: 2,
    success: deleteSuccess,
    statusCode: deleteResp.status,
    data: deleteResp.data,
    duration: deleteDuration,
    ...(!deleteSuccess && { error: `Tripletex returned ${deleteResp.status}` }),
  });

  return {
    plan: { summary: `Delete travel expense ID ${targetId}`, steps },
    stepResults,
    verified: deleteSuccess,
  };
}

async function deleteById(
  id: number,
  client: TripletexClient,
  log: Logger
): Promise<ExecutorResult> {
  const plan: ExecutionPlan = {
    summary: `Delete travel expense ID ${id}`,
    steps: [{
      stepNumber: 1,
      description: `DELETE /v2/travelExpense/${id}`,
      method: "DELETE",
      endpoint: `/v2/travelExpense/${id}`,
      resultKey: "deleteResult",
    }],
  };

  log.info(`Deleting travel expense by ID ${id}`);
  const start = Date.now();
  const resp = await client.delete(`/v2/travelExpense/${id}`);
  const duration = Date.now() - start;
  const success = resp.status >= 200 && resp.status < 300;

  let verified = false;
  if (success) {
    try {
      const check = await client.get(`/v2/travelExpense/${id}`);
      verified = check.status === 404;
    } catch {
      verified = true;
    }
  }

  return {
    plan,
    stepResults: [{
      stepNumber: 1,
      success,
      statusCode: resp.status,
      data: resp.data,
      duration,
      ...(!success && { error: `Tripletex returned ${resp.status}` }),
    }],
    verified,
  };
}

function extractListValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.values)) return d.values as Record<string, unknown>[];
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  return [];
}

function failedResult(errors: ValidationError[], reason: string, logger: Logger): ExecutorResult {
  const errorMsg = errors.length > 0
    ? errors.map((e) => `${e.field}: ${e.message}`).join("; ")
    : reason;
  logger.error("Travel expense deletion aborted", { reason });
  return {
    plan: { summary: `Travel expense deletion failed: ${reason}`, steps: [] },
    stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
    verified: false,
  };
}
