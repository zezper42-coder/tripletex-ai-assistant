// Payment registration executor — uses PUT /invoice/{id}/:payment with QUERY PARAMS
// Per OpenAPI spec: paymentDate, paymentTypeId, paidAmount are all query parameters

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { ensureCompanyBankAccount } from "../company-setup.ts";

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

function validatePaymentFields(fields: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  const hasRef = fields.invoiceId ?? fields.invoice_id ?? fields.invoiceNumber ?? fields.invoice_number ?? fields.customerName ?? fields.customer_name ?? fields.customer;
  if (!hasRef) {
    errors.push({ field: "invoiceRef", message: "At least one invoice identifier required (id, number, or customer name)" });
  }

  const amount = fields.amount ?? fields.paymentAmount ?? fields.payment_amount ?? fields.beløp ?? fields.betaling;
  if (amount !== undefined && amount !== null) {
    const n = Number(amount);
    if (isNaN(n) || n <= 0) {
      errors.push({ field: "amount", message: "Amount must be a positive number" });
    }
  }

  const date = fields.paymentDate ?? fields.payment_date ?? fields.date ?? fields.betalingsdato;
  if (date && typeof date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push({ field: "paymentDate", message: `Invalid date format: ${date}` });
  }

  return errors;
}

function normalizeFields(fields: Record<string, unknown>): PaymentFields {
  const today = new Date().toISOString().slice(0, 10);

  const invoiceId = fields.invoiceId ?? fields.invoice_id ?? fields.fakturaId;
  const invoiceNumber = fields.invoiceNumber ?? fields.invoice_number ?? fields.fakturanummer;

  return {
    ...(invoiceId ? { invoiceId: Number(invoiceId) } : {}),
    ...(invoiceNumber ? { invoiceNumber: String(invoiceNumber) } : {}),
    customerName: String(fields.customerName ?? fields.customer_name ?? fields.customer ?? fields.kunde ?? "").trim() || undefined,
    amount: fields.amount ?? fields.paymentAmount ?? fields.payment_amount ?? fields.beløp ?? fields.betaling
      ? Number(fields.amount ?? fields.paymentAmount ?? fields.payment_amount ?? fields.beløp ?? fields.betaling)
      : undefined,
    paymentDate: String(fields.paymentDate ?? fields.payment_date ?? fields.date ?? fields.betalingsdato ?? today),
    currency: (fields.currency as string)?.toUpperCase() || undefined,
    ...(fields.paymentTypeId ? { paymentTypeId: Number(fields.paymentTypeId) } : {}),
  };
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

function extractValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const vals = (d.values ?? (d.fullResultSet as Record<string, unknown>)?.values) as Record<string, unknown>[] | undefined;
  return vals ?? [];
}

export async function executePaymentCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:payment");
  const fields = parsed.fields;

  // Ensure company has bank account
  await ensureCompanyBankAccount(client, logger);

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

    const searchParams: Record<string, string> = { fields: "*" };
    if (pf.invoiceNumber) searchParams.invoiceNumber = pf.invoiceNumber;
    if (pf.customerName) searchParams.customerName = pf.customerName;

    steps.push({
      stepNumber: stepNum,
      description: `GET /v2/invoice — search`,
      method: "GET",
      endpoint: "/v2/invoice",
      queryParams: searchParams,
      resultKey: "invoiceSearch",
    });

    log.info("Searching for invoice", { searchParams });
    const start = Date.now();
    const res = await client.get("/v2/invoice", searchParams);
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
    let matches = candidates;
    if (pf.amount && matches.length > 1) {
      const amountMatches = matches.filter((inv) => {
        const total = Number(inv.amount ?? inv.amountCurrency ?? inv.balanceAmountCurrency ?? 0);
        return Math.abs(total - pf.amount!) < 0.01;
      });
      if (amountMatches.length > 0) matches = amountMatches;
    }

    if (matches.length === 0) {
      log.error("No matching invoices found");
      return {
        plan: { summary: "Payment failed: no matching invoice found", steps },
        stepResults: [...stepResults, { stepNumber: stepNum, success: false, statusCode: 0, error: "No matching invoice found", duration: 0 }],
        verified: false,
      };
    }

    // Take the first match (or exact match)
    invoiceId = matches[0].id as number;
    if (!resolvedAmount) {
      resolvedAmount = Number(matches[0].amount ?? matches[0].amountCurrency ?? matches[0].balanceAmountCurrency ?? 0);
    }
    log.info(`Resolved invoice ID: ${invoiceId}, amount: ${resolvedAmount}`);
  }

  // If we still don't have an amount, fetch the invoice
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
    const res = await client.get(`/v2/invoice/${invoiceId}`, { fields: "*" });
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

  // ── Step 2: Resolve payment type ──

  let paymentTypeId = pf.paymentTypeId;
  if (!paymentTypeId) {
    stepNum++;
    steps.push({
      stepNumber: stepNum,
      description: `GET /v2/invoice/paymentType — lookup payment types`,
      method: "GET",
      endpoint: "/v2/invoice/paymentType",
      resultKey: "paymentTypes",
    });

    const start = Date.now();
    const ptRes = await client.get("/v2/invoice/paymentType", { fields: "*" });
    const duration = Date.now() - start;

    stepResults.push({
      stepNumber: stepNum,
      success: ptRes.status === 200,
      statusCode: ptRes.status,
      data: ptRes.data,
      duration,
    });

    if (ptRes.status === 200) {
      const paymentTypes = extractValues(ptRes.data);
      // Prefer bank transfer type
      const bankType = paymentTypes.find((pt) => {
        const desc = String(pt.description ?? pt.name ?? "").toLowerCase();
        return desc.includes("bank") || desc.includes("innbetaling");
      });
      paymentTypeId = (bankType?.id ?? paymentTypes[0]?.id) as number | undefined;
      log.info(`Resolved paymentTypeId: ${paymentTypeId}`);
    }
  }

  if (!paymentTypeId) {
    log.error("Could not resolve payment type");
    return {
      plan: { summary: "Payment failed: no payment type found", steps },
      stepResults,
      verified: false,
    };
  }

  // ── Step 3: Register payment via PUT /invoice/{id}/:payment with QUERY PARAMS ──

  stepNum++;
  const paymentQueryParams: Record<string, string> = {
    paymentDate: pf.paymentDate,
    paymentTypeId: String(paymentTypeId),
    paidAmount: String(resolvedAmount ?? 0),
  };

  // For foreign currency invoices, also send paidAmountCurrency
  if (pf.currency && pf.currency !== "NOK") {
    paymentQueryParams.paidAmountCurrency = String(resolvedAmount ?? 0);
  }

  steps.push({
    stepNumber: stepNum,
    description: `PUT /v2/invoice/${invoiceId}/:payment — register payment`,
    method: "PUT",
    endpoint: `/v2/invoice/${invoiceId}/:payment`,
    queryParams: paymentQueryParams,
    resultKey: "paymentResult",
  });

  log.info("Registering payment", { invoiceId, amount: resolvedAmount, date: pf.paymentDate, paymentTypeId });
  const payStart = Date.now();
  const payRes = await client.request("PUT", `/v2/invoice/${invoiceId}/:payment`, {
    queryParams: paymentQueryParams,
  });
  const payDuration = Date.now() - payStart;
  const paySuccess = payRes.status >= 200 && payRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success: paySuccess,
    statusCode: payRes.status,
    data: payRes.data,
    duration: payDuration,
    ...(!paySuccess && { error: `Payment registration failed: ${payRes.status} ${JSON.stringify(payRes.data).substring(0, 300)}` }),
  });

  if (!paySuccess) {
    return { plan: { summary: `Payment failed for invoice ${invoiceId}`, steps }, stepResults, verified: false };
  }

  log.info(`Payment registered for invoice ${invoiceId}`);

  return {
    plan: { summary: `Payment registered for invoice ${invoiceId}`, steps },
    stepResults,
    verified: true,
  };
}
