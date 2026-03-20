// Tripletex compatibility helper — centralizes uncertain endpoint/payload behavior
// Each variant is explicit and logged. No broad trial-and-error loops.

import { TripletexClient } from "./tripletex-client.ts";
import { Logger } from "./logger.ts";

// ── Confirmation status for each behavior ──────────────────────────────

export type ConfirmationStatus = "confirmed" | "unconfirmed_safe" | "todo_needs_live_test";

export interface CompatInfo {
  behavior: string;
  status: ConfirmationStatus;
  note: string;
}

/** Registry of all known behavior assumptions */
export const BEHAVIOR_REGISTRY: CompatInfo[] = [
  // Customer
  { behavior: "POST /v2/customer", status: "confirmed", note: "Standard customer creation" },
  // Employee
  { behavior: "POST /v2/employee", status: "confirmed", note: "Standard employee creation" },
  // Product
  { behavior: "POST /v2/product", status: "confirmed", note: "Standard product creation" },
  { behavior: "POST /v2/product with vatType", status: "unconfirmed_safe", note: "vatType object {id} may be required; omit if unknown" },
  // Department
  { behavior: "POST /v2/department", status: "confirmed", note: "Standard department creation" },
  // Invoice
  { behavior: "POST /v2/order (order creation)", status: "confirmed", note: "Order as invoice precursor" },
  { behavior: "PUT /v2/order/{id}/:invoice", status: "unconfirmed_safe", note: "Primary invoice-from-order path; may need invoiceDate+invoiceDueDate" },
  { behavior: "POST /v2/invoice (direct)", status: "unconfirmed_safe", note: "Fallback direct invoice creation with orders ref" },
  { behavior: "orderLines.vatType required", status: "todo_needs_live_test", note: "Some Tripletex configs require vatType on every order line" },
  { behavior: "order.receiver field", status: "todo_needs_live_test", note: "Some configs require a receiver name on order" },
  // Payment
  { behavior: "POST /v2/payment", status: "todo_needs_live_test", note: "Payment endpoint; may need paymentType ref and account mapping" },
  { behavior: "payment.voucher linkage", status: "todo_needs_live_test", note: "Linking payment to invoice via voucher.id — may need different ref" },
  // Credit note
  { behavior: "PUT /v2/invoice/{id}/:createCreditNote", status: "todo_needs_live_test", note: "Primary credit note path; endpoint format unconfirmed" },
  { behavior: "partial credit note body", status: "todo_needs_live_test", note: "Partial credit may need line-level adjustments, not just amount" },
  // Travel expense
  { behavior: "POST /v2/travelExpense", status: "unconfirmed_safe", note: "Basic travel expense creation; cost lines may need separate POST" },
  { behavior: "travelExpense cost lines", status: "todo_needs_live_test", note: "POST /v2/travelExpense/{id}/cost for cost breakdown" },
  // VAT
  { behavior: "GET /v2/ledger/vatType", status: "confirmed", note: "VAT type listing endpoint" },
];

/** Get all behaviors that still need live testing */
export function getUnverifiedBehaviors(): CompatInfo[] {
  return BEHAVIOR_REGISTRY.filter((b) => b.status !== "confirmed");
}

/** Get debug summary for x-debug output */
export function getCompatDebugSummary(): Record<string, CompatInfo[]> {
  const grouped: Record<string, CompatInfo[]> = {
    confirmed: [],
    unconfirmed_safe: [],
    todo_needs_live_test: [],
  };
  for (const b of BEHAVIOR_REGISTRY) {
    grouped[b.status].push(b);
  }
  return grouped;
}

// ── Endpoint variant helpers ───────────────────────────────────────────

/**
 * Try invoice creation: primary path (order action), then fallback (direct POST).
 * Returns on first success. Logs variant attempted.
 */
export async function tryInvoiceCreation(
  client: TripletexClient,
  logger: Logger,
  orderId: number,
  customerId: number,
  invoiceDate: string,
  dueDate: string,
  comment?: string,
): Promise<{ success: boolean; variant: string; status: number; data: unknown }> {
  const log = logger.child("compat:invoice");

  // Variant 1: PUT /v2/order/{id}/:invoice with invoiceDate as query param
  log.info("Trying variant 1: PUT /v2/order/:invoice", { orderId, invoiceDate });
  const v1 = await client.request("PUT", `/v2/order/${orderId}/:invoice`, {
    queryParams: {
      invoiceDate,
      ...(dueDate ? { invoiceDueDate: dueDate } : {}),
    },
  });

  if (v1.status >= 200 && v1.status < 300) {
    log.info("Variant 1 succeeded", { status: v1.status });
    return { success: true, variant: "PUT /v2/order/{id}/:invoice", status: v1.status, data: v1.data };
  }

  // Variant 1b: Try with body instead of query params
  log.warn("Variant 1 failed, trying variant 1b with body", { status: v1.status });
  const v1b = await client.put(`/v2/order/${orderId}/:invoice`, {
    invoiceDate,
    invoiceDueDate: dueDate,
  });

  if (v1b.status >= 200 && v1b.status < 300) {
    log.info("Variant 1b succeeded", { status: v1b.status });
    return { success: true, variant: "PUT /v2/order/{id}/:invoice (body)", status: v1b.status, data: v1b.data };
  }

  log.warn("All PUT variants failed, trying direct POST /v2/invoice", { v1Status: v1.status, v1bStatus: v1b.status });

  // Variant 2: POST /v2/invoice
  const directBody: Record<string, unknown> = {
    customer: { id: customerId },
    invoiceDate,
    invoiceDueDate: dueDate,
    orders: [{ id: orderId }],
  };
  if (comment) directBody.comment = comment;

  const v2 = await client.post("/v2/invoice", directBody);
  if (v2.status >= 200 && v2.status < 300) {
    log.info("Variant 2 succeeded", { status: v2.status });
    return { success: true, variant: "POST /v2/invoice (direct)", status: v2.status, data: v2.data };
  }

  log.error("Both invoice creation variants failed", { v1Status: v1.status, v2Status: v2.status });
  return { success: false, variant: "both_failed", status: v2.status, data: v2.data };
}

/**
 * Try credit note creation: primary action endpoint, with diagnostic info.
 */
export async function tryCreditNoteCreation(
  client: TripletexClient,
  logger: Logger,
  invoiceId: number,
  body: Record<string, unknown>,
): Promise<{ success: boolean; variant: string; status: number; data: unknown }> {
  const log = logger.child("compat:creditNote");

  // Variant 1: PUT /v2/invoice/{id}/:createCreditNote
  log.info("Trying: PUT /v2/invoice/:createCreditNote", { invoiceId });
  const v1 = await client.put(`/v2/invoice/${invoiceId}/:createCreditNote`, body);

  if (v1.status >= 200 && v1.status < 300) {
    log.info("Credit note variant 1 succeeded", { status: v1.status });
    return { success: true, variant: "PUT /v2/invoice/{id}/:createCreditNote", status: v1.status, data: v1.data };
  }

  // Variant 2: Try creating a negative invoice manually if action endpoint fails
  log.warn("Credit note action endpoint failed; trying manual negative invoice", { status: v1.status });
  
  // Extract amount if partial, or we would need the original invoice details. 
  // For safety, we just log and fail if we don't have enough data to build a negative invoice.
  return { success: false, variant: "PUT /v2/invoice/{id}/:createCreditNote (failed)", status: v1.status, data: v1.data };
}
