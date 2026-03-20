// Payment creation executor — deterministic invoice resolution + payment registration

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

// ── Types ──────────────────────────────────────────────────────────────

interface PaymentFields {
  invoiceId?: number;
  invoiceNumber?: string;
  customerName?: string;
  amount?: number;
  paymentDate: string;
  currency?: string;
  paymentTypeId?: number;
}

interface ValidationError { field: string; message: string; }

// ── Validation ─────────────────────────────────────────────────────────

function validatePaymentFields(fields: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  const hasRef = fields.invoiceId ?? fields.invoice_id ?? fields.invoiceNumber ?? fields.invoice_number ?? fields.customerName ?? fields.customer_name ?? fields.customer;
  if (!hasRef) {
    errors.push({ field: "invoiceRef", message: "At least one invoice identifier required (id, number, or customer name)" });
  }

  const amount = fields.amount ?? fields.paymentAmount ?? fields.payment_amount;
  if (amount !== undefined && amount !== null) {
    const n = Number(amount);
    if (isNaN(n) || n <= 0) {
      errors.push({ field: "amount", message: "Amount must be a positive number" });
    }
  }

  const date = fields.paymentDate ?? fields.payment_date ?? fields.date;
  if (date && typeof date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push({ field: "paymentDate", message: `Invalid date format: ${date}` });
  }

  return errors;
}

// ── Field normalization ────────────────────────────────────────────────

function normalizeFields(fields: Record<string, unknown>): PaymentFields {
  const today = new Date().toISOString().slice(0, 10);

  const invoiceId = fields.invoiceId ?? fields.invoice_id;
  const invoiceNumber = fields.invoiceNumber ?? fields.invoice_number;

  return {
    ...(invoiceId ? { invoiceId: Number(invoiceId) } : {}),
    ...(invoiceNumber ? { invoiceNumber: String(invoiceNumber) } : {}),
    customerName: String(fields.customerName ?? fields.customer_name ?? fields.customer ?? "").trim() || undefined,
    amount: fields.amount ?? fields.paymentAmount ?? fields.payment_amount
      ? Number(fields.amount ?? fields.paymentAmount ?? fields.payment_amount)
      : undefined,
    paymentDate: String(fields.paymentDate ?? fields.payment_date ?? fields.date ?? today),
    currency: (fields.currency as string)?.toUpperCase() || undefined,
    ...(fields.paymentTypeId ? { paymentTypeId: Number(fields.paymentTypeId) } : {}),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

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

function extractValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const vals = (d.values ?? (d.fullResultSet as Record<string, unknown>)?.values) as Record<string, unknown>[] | undefined;
  return vals ?? [];
}

// ── Main executor ──────────────────────────────────────────────────────

export async function executePaymentCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:payment");
  const fields = parsed.fields;

  // Validate
  const errors = validatePaymentFields(fields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    return {
      plan: { summary: "Payment creation failed: validation errors", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
      verified: false,
    };
  }

  const pf = normalizeFields(fields);
  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // ── Step 1: Resolve invoice ──

  let invoiceId: number | undefined = pf.invoiceId;
  let resolvedAmount = pf.amount;

  if (!invoiceId) {
    stepNum++;

    // Build narrow search params
    const searchParams: Record<string, string> = {};
    if (pf.invoiceNumber) searchParams.invoiceNumber = pf.invoiceNumber;
    if (pf.customerName) searchParams.customerName = pf.customerName;
    // TODO: confirm exact query param names for Tripletex /v2/invoice search

    const searchDesc = pf.invoiceNumber
      ? `search by number "${pf.invoiceNumber}"`
      : `search by customer "${pf.customerName}"`;

    steps.push({
      stepNumber: stepNum,
      description: `GET /v2/invoice — ${searchDesc}`,
      method: "GET",
      endpoint: "/v2/invoice",
      queryParams: searchParams,
      resultKey: "invoiceSearch",
    });

    log.info("Searching for invoice", { searchParams });
    const start = Date.now();
    const res = await client.get("/v2/invoice", { ...searchParams, fields: "*" });
    const duration = Date.now() - start;

    stepResults.push({
      stepNumber: stepNum,
      success: res.status === 200,
      statusCode: res.status,
      data: res.data,
      duration,
    });

    if (res.status !== 200) {
      return { plan: { summary: "Payment failed: invoice search error", steps }, stepResults, verified: false };
    }

    const candidates = extractValues(res.data);

    // Filter by amount if provided
    let matches = candidates;
    if (pf.amount && matches.length > 1) {
      const amountMatches = matches.filter((inv) => {
        const total = Number(inv.amount ?? inv.amountCurrency ?? inv.balanceAmountCurrency ?? 0);
        return Math.abs(total - pf.amount!) < 0.01;
      });
      if (amountMatches.length > 0) matches = amountMatches;
    }

    if (matches.length === 0) {
      log.error("No matching invoices found", { searchParams });
      return {
        plan: { summary: "Payment failed: no matching invoice found", steps },
        stepResults: [...stepResults, { stepNumber: stepNum, success: false, statusCode: 0, error: "No matching invoice found", duration: 0 }],
        verified: false,
      };
    }

    if (matches.length > 1) {
      log.error("Ambiguous invoice match", { count: matches.length, ids: matches.map((m) => m.id) });
      return {
        plan: { summary: `Payment failed: ${matches.length} invoices matched — ambiguous`, steps },
        stepResults: [...stepResults, { stepNumber: stepNum, success: false, statusCode: 0, error: `Ambiguous: ${matches.length} invoices match`, duration: 0 }],
        verified: false,
      };
    }

    invoiceId = matches[0].id as number;
    if (!resolvedAmount) {
      resolvedAmount = Number(matches[0].amount ?? matches[0].amountCurrency ?? matches[0].balanceAmountCurrency ?? 0);
    }
    log.info(`Resolved invoice ID: ${invoiceId}, amount: ${resolvedAmount}`);
  }

  // If we still don't have an amount, try to fetch the invoice to get it
  if (!resolvedAmount && invoiceId) {
    stepNum++;
    steps.push({
      stepNumber: stepNum,
      description: `GET /v2/invoice/${invoiceId} — fetch amount`,
      method: "GET",
      endpoint: `/v2/invoice/${invoiceId}`,
      resultKey: "invoiceDetail",
    });

    const start = Date.now();
    const res = await client.get(`/v2/invoice/${invoiceId}`);
    const duration = Date.now() - start;

    stepResults.push({
      stepNumber: stepNum,
      success: res.status === 200,
      statusCode: res.status,
      data: res.data,
      duration,
    });

    if (res.status === 200 && res.data) {
      const d = res.data as Record<string, unknown>;
      const val = (d.value ?? d) as Record<string, unknown>;
      resolvedAmount = Number(val.amount ?? val.amountCurrency ?? val.balanceAmountCurrency ?? 0);
    }
  }

  // ── Step 2: Create payment ──

  stepNum++;
  // TODO: confirm exact Tripletex payment endpoint and required body fields
  // Tripletex may use POST /v2/payment or a payment-type-specific endpoint
  const paymentBody: Record<string, unknown> = {
    paymentDate: pf.paymentDate,
    amount: resolvedAmount ?? 0,
    // TODO: Tripletex may require paymentType or account references
    ...(pf.paymentTypeId ? { paymentType: { id: pf.paymentTypeId } } : {}),
    ...(pf.currency ? { currency: { code: pf.currency } } : {}),
  };

  // TODO: confirm if Tripletex links payment to invoice via voucher reference or direct invoiceId
  // Trying the most common pattern first
  paymentBody.voucher = { id: invoiceId };

  steps.push({
    stepNumber: stepNum,
    description: `POST /v2/payment — register payment for invoice ${invoiceId}`,
    method: "POST",
    endpoint: "/v2/payment",
    body: paymentBody,
    resultKey: "paymentId",
  });

  log.info("Creating payment", { invoiceId, amount: resolvedAmount, date: pf.paymentDate });
  const payStart = Date.now();
  const payRes = await client.post("/v2/payment", paymentBody);
  const payDuration = Date.now() - payStart;
  const paySuccess = payRes.status >= 200 && payRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success: paySuccess,
    statusCode: payRes.status,
    data: payRes.data,
    duration: payDuration,
    ...(!paySuccess && { error: `Payment creation failed: ${payRes.status}` }),
  });

  if (!paySuccess) {
    return { plan: { summary: `Payment failed for invoice ${invoiceId}`, steps }, stepResults, verified: false };
  }

  const paymentId = extractId(payRes.data);
  log.info(`Payment created, ID: ${paymentId}`);

  return {
    plan: { summary: `Payment registered for invoice ${invoiceId}, payment ID: ${paymentId}`, steps },
    stepResults,
    verified: true,
  };
}
