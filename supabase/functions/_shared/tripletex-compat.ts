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
  { behavior: "POST /v2/customer", status: "confirmed", note: "Standard customer creation" },
  { behavior: "POST /v2/employee", status: "confirmed", note: "Standard employee creation" },
  { behavior: "POST /v2/product", status: "confirmed", note: "Standard product creation" },
  { behavior: "POST /v2/product with vatType", status: "unconfirmed_safe", note: "vatType object {id} may be required; omit if unknown" },
  { behavior: "POST /v2/department", status: "confirmed", note: "Standard department creation" },
  { behavior: "POST /v2/order (order creation)", status: "confirmed", note: "Order as invoice precursor" },
  { behavior: "PUT /v2/order/{id}/:invoice", status: "confirmed", note: "Primary invoice-from-order path; invoiceDate as query param" },
  { behavior: "POST /v2/invoice (direct)", status: "unconfirmed_safe", note: "Fallback direct invoice creation with orders ref" },
  { behavior: "PUT /v2/invoice/{id}/:payment", status: "confirmed", note: "Payment registration via query params: paymentDate, paymentTypeId, paidAmount" },
  { behavior: "PUT /v2/invoice/{id}/:createCreditNote", status: "confirmed", note: "Credit note via query params: date (required), comment (optional)" },
  { behavior: "POST /v2/travelExpense", status: "unconfirmed_safe", note: "Basic travel expense creation" },
  { behavior: "GET /v2/ledger/vatType", status: "confirmed", note: "VAT type listing endpoint" },
  { behavior: "POST /v2/company/salesmodules", status: "confirmed", note: "Activate sales modules (department etc)" },
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
    return { success: true, variant: "PUT /2/order/{id}/:invoice (body)", status: v1b.status, data: v1b.data };
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
 * Try credit note creation using the correct OpenAPI endpoint:
 * PUT /v2/invoice/{id}/:createCreditNote
 * 
 * Per OpenAPI spec, parameters are QUERY PARAMS (not body):
 * - date: string (REQUIRED, YYYY-MM-DD)
 * - comment: string (optional)
 * - creditNoteEmail: string (optional)
 * - sendToCustomer: boolean (optional)
 */
export async function tryCreditNoteCreation(
  client: TripletexClient,
  logger: Logger,
  invoiceId: number,
  body: Record<string, unknown>,
): Promise<{ success: boolean; variant: string; status: number; data: unknown }> {
  const log = logger.child("compat:creditNote");

  // Build query params from the body fields
  const today = new Date().toISOString().split("T")[0];
  const date = String(body.date ?? body.creditNoteDate ?? today);
  const queryParams: Record<string, string> = { date };
  if (body.comment) queryParams.comment = String(body.comment);
  if (body.reason) queryParams.comment = String(body.reason);
  if (body.creditNoteEmail) queryParams.creditNoteEmail = String(body.creditNoteEmail);

  // Variant 1: PUT with query params (correct per OpenAPI spec)
  log.info("Trying: PUT /v2/invoice/:createCreditNote with query params", { invoiceId, queryParams });
  const v1 = await client.request("PUT", `/v2/invoice/${invoiceId}/:createCreditNote`, { queryParams });

  if (v1.status >= 200 && v1.status < 300) {
    log.info("Credit note variant 1 succeeded (query params)", { status: v1.status });
    return { success: true, variant: "PUT /v2/invoice/{id}/:createCreditNote (query)", status: v1.status, data: v1.data };
  }

  // Variant 2: PUT with body (fallback)
  log.warn("Query param variant failed, trying with body", { status: v1.status });
  const v2 = await client.put(`/v2/invoice/${invoiceId}/:createCreditNote`, { date, comment: queryParams.comment });

  if (v2.status >= 200 && v2.status < 300) {
    log.info("Credit note variant 2 succeeded (body)", { status: v2.status });
    return { success: true, variant: "PUT /v2/invoice/{id}/:createCreditNote (body)", status: v2.status, data: v2.data };
  }

  log.error("All credit note variants failed", { v1Status: v1.status, v2Status: v2.status });
  return { success: false, variant: "all_failed", status: v2.status, data: v2.data };
}

/**
 * Enable sales/accounting modules in Tripletex.
 * POST /v2/company/salesmodules activates modules like department tracking.
 */
export async function enableSalesModules(
  client: TripletexClient,
  logger: Logger,
): Promise<{ success: boolean; status: number; data: unknown }> {
  const log = logger.child("compat:salesModules");
  log.info("Activating sales modules via POST /v2/company/salesmodules");

  const res = await client.post("/v2/company/salesmodules", {});
  const success = res.status >= 200 && res.status < 300;
  if (success) {
    log.info("Sales modules activated", { status: res.status });
  } else {
    log.warn("Sales module activation failed (may already be active)", { status: res.status });
  }
  return { success, status: res.status, data: res.data };
}

/**
 * Grant administrator entitlements to an employee.
 * Tries multiple template names and ensures userType is EXTENDED.
 */
export async function grantAdminEntitlements(
  client: TripletexClient,
  logger: Logger,
  employeeId: number,
): Promise<{ success: boolean; status: number; data: unknown; template?: string }> {
  const log = logger.child("compat:adminEntitlement");

  // Step 1: Ensure employee has userType EXTENDED (required for admin access)
  log.info("Setting userType to EXTENDED for admin access", { employeeId });
  const getRes = await client.get(`/v2/employee/${employeeId}`, { fields: "*" });
  if (getRes.status === 200) {
    const current = ((getRes.data as any)?.value ?? getRes.data) as Record<string, unknown>;
    const version = current.version as number | undefined;
    if (current.userType !== "EXTENDED") {
      const updateBody: Record<string, unknown> = {
        id: employeeId,
        firstName: current.firstName,
        lastName: current.lastName,
        userType: "EXTENDED",
      };
      if (version !== undefined) updateBody.version = version;
      const putRes = await client.putWithRetry(`/v2/employee/${employeeId}`, updateBody);
      if (putRes.status >= 200 && putRes.status < 300) {
        log.info("userType set to EXTENDED");
      } else {
        log.warn("Failed to set userType to EXTENDED", { status: putRes.status });
      }
    }
  }

  // Step 2: Try entitlement templates in order of likelihood
  const templates = ["all_administrator", "administrator", "all"];
  const grantUrl = "/v2/employee/entitlement/:grantEntitlementsByTemplate";

  for (const template of templates) {
    log.info(`Trying entitlement template: ${template}`, { employeeId });
    const res = await client.request("PUT", grantUrl, {
      queryParams: { employeeId: String(employeeId), template },
    });
    const success = res.status >= 200 && res.status < 300;
    if (success) {
      log.info(`Admin entitlement granted with template: ${template}`);
      return { success: true, status: res.status, data: res.data, template };
    }
    log.warn(`Template "${template}" failed`, { status: res.status });
  }

  log.error("All entitlement templates failed");
  return { success: false, status: 0, data: null };
}
