// Travel expense creation executor — deterministic employee resolution + minimal payload

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

interface ValidationError { field: string; message: string; }

function validateTravelExpenseCreateFields(fields: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  // At least one employee reference required
  const empId = fields.employeeId ?? fields.employee_id;
  const empEmail = fields.employeeEmail ?? fields.employee_email ?? fields.email;
  const empName = fields.employeeName ?? fields.employee_name ?? fields.ansatt ?? fields.empleado ?? fields.funcionário ?? fields.Mitarbeiter ?? fields.employé;
  if (!empId && !empEmail && !empName) {
    errors.push({ field: "employee", message: "At least one employee reference required (id, email, or name)" });
  }

  // Amount validation
  const amount = fields.amount ?? fields.beløp ?? fields.beloep ?? fields.monto ?? fields.Betrag ?? fields.montant;
  if (amount !== undefined && amount !== null) {
    const n = Number(amount);
    if (isNaN(n) || n < 0) {
      errors.push({ field: "amount", message: `Amount must be a non-negative number: ${amount}` });
    }
  }

  // Date validation
  const date = fields.travelDate ?? fields.travel_date ?? fields.date ?? fields.dato ?? fields.fecha ?? fields.Datum;
  if (date !== undefined && date !== null) {
    const d = new Date(String(date));
    if (isNaN(d.getTime())) {
      errors.push({ field: "travelDate", message: `Invalid date: ${date}` });
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

function extractListValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.values)) return d.values as Record<string, unknown>[];
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  return [];
}

export async function executeTravelExpenseCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:travelExpenseCreate");
  const f = parsed.fields;

  // ── Normalize field aliases ──
  const empId = (f.employeeId ?? f.employee_id) as number | string | undefined;
  const empEmail = (f.employeeEmail ?? f.employee_email ?? f.email) as string | undefined;
  const empName = (f.employeeName ?? f.employee_name ?? f.ansatt ?? f.empleado ?? f.funcionário ?? f.Mitarbeiter ?? f.employé) as string | undefined;
  const travelDate = (f.travelDate ?? f.travel_date ?? f.date ?? f.dato ?? f.fecha ?? f.Datum) as string | undefined;
  const amount = (f.amount ?? f.beløp ?? f.beloep ?? f.monto ?? f.Betrag ?? f.montant) as number | string | undefined;
  const currency = (f.currency ?? f.valuta ?? f.moneda ?? f.Währung ?? f.devise) as string | undefined;
  const fromLocation = (f.fromLocation ?? f.from_location ?? f.from ?? f.fra ?? f.desde ?? f.von) as string | undefined;
  const toLocation = (f.toLocation ?? f.to_location ?? f.to ?? f.til ?? f.hasta ?? f.nach) as string | undefined;
  const purpose = (f.purpose ?? f.formål ?? f.formaal ?? f.propósito ?? f.Zweck ?? f.objet) as string | undefined;
  const description = (f.description ?? f.beskrivelse ?? f.descripcion ?? f.Beschreibung) as string | undefined;

  const normalized: Record<string, unknown> = {
    ...(empId !== undefined && { employeeId: empId }),
    ...(empEmail && { employeeEmail: empEmail }),
    ...(empName && { employeeName: empName }),
    ...(amount !== undefined && { amount }),
    ...(travelDate && { travelDate }),
  };

  const errors = validateTravelExpenseCreateFields({ ...f, ...normalized });
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    return {
      plan: { summary: "Travel expense creation failed: validation errors", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
      verified: false,
    };
  }

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // ── Step 1: Resolve employee ──
  let resolvedEmployeeId: number | undefined;

  if (empId) {
    resolvedEmployeeId = Number(empId);
    log.info(`Using provided employee ID: ${resolvedEmployeeId}`);
  } else {
    // Search by email first (most precise), then by name
    const searchParams: Record<string, string> = {};
    let searchDesc: string;

    if (empEmail) {
      searchParams.email = empEmail.trim();
      searchDesc = `GET /v2/employee — search by email "${empEmail}"`;
    } else {
      const parts = String(empName).trim().split(/\s+/);
      searchParams.firstName = parts[0] || "";
      if (parts.length > 1) {
        searchParams.lastName = parts.slice(1).join(" ");
      }
      searchDesc = `GET /v2/employee — search by name "${empName}"`;
    }

    stepNum++;
    steps.push({
      stepNumber: stepNum,
      description: searchDesc,
      method: "GET",
      endpoint: "/v2/employee",
      queryParams: searchParams,
      resultKey: "employeeSearch",
    });

    log.info("Searching employee", { searchParams });
    const start = Date.now();
    const res = await client.get("/v2/employee", { ...searchParams, fields: "*" });
    const duration = Date.now() - start;
    const success = res.status >= 200 && res.status < 300;

    stepResults.push({ stepNumber: stepNum, success, statusCode: res.status, data: res.data, duration });

    if (!success) {
      return {
        plan: { summary: "Employee search failed", steps },
        stepResults,
        verified: false,
      };
    }

    const employees = extractListValues(res.data);

    if (employees.length === 0) {
      log.warn("No matching employee found");
      return {
        plan: { summary: "Travel expense creation failed: employee not found", steps },
        stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: `No employee found for: ${empEmail || empName}`, duration: 0 }],
        verified: false,
      };
    }

    if (employees.length > 1) {
      log.warn(`Ambiguous: ${employees.length} employees matched`);
      return {
        plan: { summary: `Travel expense creation failed: ${employees.length} employees matched (ambiguous)`, steps },
        stepResults: [{
          stepNumber: 0, success: false, statusCode: 0,
          error: `Ambiguous employee: ${employees.length} matches. Provide more specific identifier.`,
          duration: 0,
          data: { matchCount: employees.length, matchIds: employees.map((e) => e.id) },
        }],
        verified: false,
      };
    }

    resolvedEmployeeId = employees[0].id as number;
    log.info(`Resolved employee ID: ${resolvedEmployeeId}`);
  }

  // ── Step 2: Create travel expense ──
  // TODO: Confirm exact Tripletex travelExpense body shape.
  // The payload below is a best-effort minimal body. Fields like
  // `rateCategoryType`, `perDiemCompensation`, `isCompleted`, `travelDetails`
  // may be required or have different names in the live API.
  const title = purpose || description || "Travel expense";
  const body: Record<string, unknown> = {
    employee: { id: resolvedEmployeeId },
    title: title.trim(),
    ...(travelDate && { departureDate: travelDate }),
    ...(travelDate && { returnDate: travelDate }), // same day if no return date given
    ...(fromLocation && { departure: fromLocation.trim() }),
    ...(toLocation && { destination: toLocation.trim() }),
    ...(description && { description: description.trim() }),
    // TODO: amount handling — Tripletex travel expenses may use cost line items
    // rather than a top-level amount field. If so, create a cost line after expense creation.
  };

  stepNum++;
  steps.push({
    stepNumber: stepNum,
    description: `POST /v2/travelExpense — create "${title}"`,
    method: "POST",
    endpoint: "/v2/travelExpense",
    body,
    resultKey: "travelExpenseId",
  });

  log.info("Creating travel expense", { body });
  const createStart = Date.now();
  const createRes = await client.post("/v2/travelExpense", body);
  const createDuration = Date.now() - createStart;
  const createSuccess = createRes.status >= 200 && createRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success: createSuccess,
    statusCode: createRes.status,
    data: createRes.data,
    duration: createDuration,
    ...(!createSuccess && { error: `Travel expense creation failed: ${createRes.status}` }),
  });

  if (!createSuccess) {
    return { plan: { summary: `Travel expense creation failed for "${title}"`, steps }, stepResults, verified: false };
  }

  const expenseId = extractId(createRes.data);
  log.info(`Travel expense created, ID: ${expenseId}`);

  // ── Optional: Add cost line if amount is provided ──
  // TODO: Tripletex may require adding costs via POST /v2/travelExpense/cost
  // after the travel expense is created. This needs live confirmation.
  if (amount !== undefined && expenseId) {
    log.info(`Amount ${amount} provided — cost line creation pending live API confirmation`);
    // TODO: POST /v2/travelExpense/{id}/cost with { amount, currency, description }
  }

  // ── Minimal verification ──
  let verified = false;
  if (expenseId) {
    try {
      const check = await client.get(`/v2/travelExpense/${expenseId}`);
      verified = check.status === 200;
    } catch (err) {
      log.warn("Verification failed", { error: String(err) });
    }
  }

  return {
    plan: { summary: `Travel expense created: "${title}", ID: ${expenseId}`, steps },
    stepResults,
    verified,
  };
}
