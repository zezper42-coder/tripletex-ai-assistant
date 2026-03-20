// Credit note creation executor — deterministic invoice credit/reversal

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { validateCreditNoteFields } from "../field-validation.ts";

// TODO: Confirm exact Tripletex credit note endpoint and payload shape with live API
// Primary path: PUT /v2/invoice/{id}/:createCreditNote
// Fallback: POST /v2/invoice with negative line amounts referencing original invoice

export async function executeCreditNoteCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger,
): Promise<ExecutorResult> {
  const fields = parsed.fields ?? {};
  const steps: ExecutionPlan["steps"] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // ── Validation ──────────────────────────────────────────────
  const errors = validateCreditNoteFields(fields);
  if (errors.length > 0) {
    logger.warn("Credit note validation failed", { errors });
    return {
      plan: { summary: "Validation failed", steps: [] },
      stepResults: [{
        stepNumber: 1, success: false, statusCode: 400,
        data: { errors }, duration: 0,
      }],
      verified: false,
    };
  }

  // ── Resolve invoice ─────────────────────────────────────────
  const invoiceId = fields.invoiceId ?? fields.invoice_id;
  const invoiceNumber = fields.invoiceNumber ?? fields.invoice_number;
  const customerName = fields.customerName ?? fields.customer_name;
  let resolvedInvoiceId: number | null = null;
  let invoiceTotal: number | null = null;

  if (invoiceId) {
    resolvedInvoiceId = Number(invoiceId);
    logger.info("Using direct invoice ID", { resolvedInvoiceId });
  } else if (invoiceNumber) {
    stepNum++;
    const desc = `GET /v2/invoice — search by number "${invoiceNumber}"`;
    steps.push({ stepNumber: stepNum, description: desc, method: "GET", endpoint: "/v2/invoice", queryParams: { invoiceNumber: String(invoiceNumber) }, resultKey: "invoiceSearch" });

    const searchRes = await client.get("/v2/invoice", { invoiceNumber: String(invoiceNumber) });
    const sr: StepResult = { stepNumber: stepNum, success: searchRes.ok, statusCode: searchRes.status, data: searchRes.data, duration: 0 };
    stepResults.push(sr);

    const values = searchRes.data?.values ?? searchRes.data?.value ? [searchRes.data.value] : [];
    const candidates = searchRes.data?.values ?? values;

    if (!searchRes.ok || candidates.length === 0) {
      logger.warn("No invoice found by number", { invoiceNumber });
      return { plan: { summary: "Invoice not found", steps }, stepResults, verified: false };
    }
    if (candidates.length > 1) {
      logger.warn("Ambiguous invoice match", { invoiceNumber, count: candidates.length });
      return { plan: { summary: `Ambiguous: ${candidates.length} invoices match number ${invoiceNumber}`, steps }, stepResults, verified: false };
    }
    resolvedInvoiceId = candidates[0].id;
    invoiceTotal = candidates[0].amount ?? candidates[0].totalAmount ?? null;
  } else if (customerName) {
    stepNum++;
    const desc = `GET /v2/invoice — search by customer "${customerName}"`;
    steps.push({ stepNumber: stepNum, description: desc, method: "GET", endpoint: "/v2/invoice", queryParams: { customerName: String(customerName) }, resultKey: "invoiceSearch" });

    const searchRes = await client.get("/v2/invoice", { customerName: String(customerName) });
    const sr: StepResult = { stepNumber: stepNum, success: searchRes.ok, statusCode: searchRes.status, data: searchRes.data, duration: 0 };
    stepResults.push(sr);

    const candidates = searchRes.data?.values ?? [];
    if (!searchRes.ok || candidates.length === 0) {
      logger.warn("No invoice found for customer", { customerName });
      return { plan: { summary: "Invoice not found for customer", steps }, stepResults, verified: false };
    }
    if (candidates.length > 1) {
      logger.warn("Ambiguous invoice match by customer", { customerName, count: candidates.length });
      return { plan: { summary: `Ambiguous: ${candidates.length} invoices for customer ${customerName}`, steps }, stepResults, verified: false };
    }
    resolvedInvoiceId = candidates[0].id;
    invoiceTotal = candidates[0].amount ?? candidates[0].totalAmount ?? null;
  }

  if (!resolvedInvoiceId) {
    return {
      plan: { summary: "No invoice reference could be resolved", steps },
      stepResults, verified: false,
    };
  }

  // ── Determine full vs partial credit ────────────────────────
  const requestedAmount = fields.amount != null ? Number(fields.amount) : null;
  const isPartial = requestedAmount != null && invoiceTotal != null && requestedAmount < invoiceTotal;
  const creditMode = isPartial ? "partial" : "full";
  logger.info("Credit mode", { creditMode, requestedAmount, invoiceTotal });

  // ── Create credit note ──────────────────────────────────────
  // TODO: Confirm PUT /v2/invoice/{id}/:createCreditNote is correct path
  // TODO: Confirm if partial credit requires specific body fields
  stepNum++;
  const creditDesc = `PUT /v2/invoice/${resolvedInvoiceId}/:createCreditNote — ${creditMode} credit`;
  const creditBody: Record<string, unknown> = {};
  if (fields.reason) creditBody.comment = fields.reason;
  if (isPartial && requestedAmount != null) {
    // TODO: Confirm partial credit body shape — may need creditedAmount or line-level adjustments
    creditBody.amount = requestedAmount;
  }

  steps.push({ stepNumber: stepNum, description: creditDesc, method: "PUT", endpoint: `/v2/invoice/${resolvedInvoiceId}/:createCreditNote`, body: creditBody, resultKey: "creditNoteId" });

  const creditRes = await client.put(`/v2/invoice/${resolvedInvoiceId}/:createCreditNote`, creditBody);
  const creditSr: StepResult = { stepNumber: stepNum, success: creditRes.ok, statusCode: creditRes.status, data: creditRes.data, duration: 0 };
  stepResults.push(creditSr);

  if (!creditRes.ok) {
    logger.warn("Credit note creation failed", { status: creditRes.status, data: creditRes.data });
    // TODO: Implement fallback via POST /v2/invoice with negative amounts if action endpoint unsupported
    return {
      plan: { summary: `Credit note creation failed (${creditRes.status})`, steps },
      stepResults, verified: false,
    };
  }

  const creditNoteId = creditRes.data?.value?.id ?? creditRes.data?.id ?? null;
  const summary = creditNoteId
    ? `Credit note created (ID: ${creditNoteId}) for invoice ${resolvedInvoiceId} — ${creditMode}`
    : `Credit note created for invoice ${resolvedInvoiceId} — ${creditMode}`;

  return {
    plan: { summary, steps },
    stepResults,
    verified: true,
  };
}
