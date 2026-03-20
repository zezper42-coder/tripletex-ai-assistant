// Credit note creation executor — deterministic invoice credit/reversal

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { validateCreditNoteFields } from "../field-validation.ts";
import { tryCreditNoteCreation } from "../tripletex-compat.ts";

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

  // ── Create credit note via compat helper ─────────────────────
  stepNum++;
  const creditBody: Record<string, unknown> = {};
  if (fields.reason) creditBody.comment = fields.reason;
  if (isPartial && requestedAmount != null) {
    creditBody.amount = requestedAmount;
  }

  const creditDesc = `Credit note for invoice ${resolvedInvoiceId} — ${creditMode}`;
  steps.push({ stepNumber: stepNum, description: creditDesc, method: "PUT", endpoint: `/v2/invoice/${resolvedInvoiceId}/:createCreditNote`, body: creditBody, resultKey: "creditNoteId" });

  const creditResult = await tryCreditNoteCreation(client, logger, resolvedInvoiceId, creditBody);
  const creditSr: StepResult = { stepNumber: stepNum, success: creditResult.success, statusCode: creditResult.status, data: creditResult.data, duration: 0 };
  stepResults.push(creditSr);

  if (!creditResult.success) {
    logger.warn("Credit note creation failed", { variant: creditResult.variant, status: creditResult.status });
    return {
      plan: { summary: `Credit note failed via ${creditResult.variant}`, steps },
      stepResults, verified: false,
    };
  }

  const creditNoteData = creditResult.data as Record<string, unknown> | null;
  const creditNoteId = creditNoteData?.value
    ? (creditNoteData.value as Record<string, unknown>).id
    : creditNoteData?.id ?? null;
  const summary = creditNoteId
    ? `Credit note created (ID: ${creditNoteId}) for invoice ${resolvedInvoiceId} — ${creditMode} (via ${creditResult.variant})`
    : `Credit note created for invoice ${resolvedInvoiceId} — ${creditMode}`;

  return {
    plan: { summary, steps },
    stepResults,
    verified: true,
  };
}
