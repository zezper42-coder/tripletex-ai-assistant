// Invoice creation executor — deterministic path with customer/order dependency handling

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { VatTypeLookup } from "../vat-lookup.ts";
import { tryInvoiceCreation } from "../tripletex-compat.ts";

// ── Types ──────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  productId?: number;
  vatTypeId?: number;
}

interface InvoiceFields {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerOrgNr?: string;
  invoiceDate: string;
  dueDate: string;
  lineItems: LineItem[];
  comment?: string;
}

interface ValidationError {
  field: string;
  message: string;
}

// ── Validation ─────────────────────────────────────────────────────────

function validateInvoiceFields(fields: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  const customerName = fields.customerName ?? fields.customer_name ?? fields.customer;
  if (!customerName || (typeof customerName === "string" && !customerName.trim())) {
    errors.push({ field: "customerName", message: "Customer name or reference is required" });
  }

  const lineItems = (fields.lineItems ?? fields.line_items ?? fields.lines) as unknown[];
  if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
    errors.push({ field: "lineItems", message: "At least one line item is required" });
  } else {
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i] as Record<string, unknown>;
      if (!li.description && !li.product) {
        errors.push({ field: `lineItems[${i}].description`, message: "Line item needs description or product" });
      }
      const qty = Number(li.quantity ?? li.count ?? 1);
      if (qty <= 0) {
        errors.push({ field: `lineItems[${i}].quantity`, message: "Quantity must be positive" });
      }
      const price = Number(li.unitPrice ?? li.unit_price ?? li.price ?? 0);
      if (price < 0) {
        errors.push({ field: `lineItems[${i}].unitPrice`, message: "Unit price cannot be negative" });
      }
    }
  }

  // Date validation
  const invoiceDate = fields.invoiceDate ?? fields.invoice_date;
  const dueDate = fields.dueDate ?? fields.due_date ?? fields.invoiceDueDate;
  if (invoiceDate && dueDate && String(dueDate) < String(invoiceDate)) {
    errors.push({ field: "dueDate", message: "Due date cannot be before invoice date" });
  }

  // Email validation if present
  const email = fields.customerEmail ?? fields.customer_email;
  if (email && typeof email === "string") {
    const emailRe = /^[\w.+-]+@[\w.-]+\.\w{2,}$/i;
    if (!emailRe.test(email.trim())) {
      errors.push({ field: "customerEmail", message: `Invalid email: ${email}` });
    }
  }

  return errors;
}

// ── Field normalization ────────────────────────────────────────────────

function normalizeFields(fields: Record<string, unknown>): InvoiceFields {
  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const rawLines = (fields.lineItems ?? fields.line_items ?? fields.lines ?? []) as Record<string, unknown>[];
  const lineItems: LineItem[] = rawLines.map((li) => ({
    description: String(li.description ?? li.product ?? li.name ?? "Item"),
    quantity: Number(li.quantity ?? li.count ?? 1),
    unitPrice: Number(li.unitPrice ?? li.unit_price ?? li.price ?? 0),
    ...(li.productId ? { productId: Number(li.productId) } : {}),
    ...(li.vatTypeId ? { vatTypeId: Number(li.vatTypeId) } : {}),
  }));

  return {
    customerName: String(fields.customerName ?? fields.customer_name ?? fields.customer ?? ""),
    customerEmail: (fields.customerEmail ?? fields.customer_email) as string | undefined,
    customerPhone: (fields.customerPhone ?? fields.customer_phone ?? fields.phoneNumber) as string | undefined,
    customerOrgNr: (fields.customerOrgNr ?? fields.organizationNumber) as string | undefined,
    invoiceDate: String(fields.invoiceDate ?? fields.invoice_date ?? today),
    dueDate: String(fields.dueDate ?? fields.due_date ?? fields.invoiceDueDate ?? defaultDue),
    lineItems,
    comment: (fields.comment ?? fields.description) as string | undefined,
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

// ── Main executor ──────────────────────────────────────────────────────

export async function executeInvoiceCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:invoice");
  const fields = parsed.fields;

  // Validate
  const errors = validateInvoiceFields(fields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    return {
      plan: { summary: "Invoice creation failed: validation errors", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
      verified: false,
    };
  }

  const inv = normalizeFields(fields);
  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // ── Step 1: Resolve or create customer ──

  let customerId: number | undefined;
  stepNum++;

  // Search for existing customer
  log.info(`Searching for customer: ${inv.customerName}`);
  const searchStep: ExecutionStep = {
    stepNumber: stepNum,
    description: `GET /v2/customer — search "${inv.customerName}"`,
    method: "GET",
    endpoint: "/v2/customer",
    queryParams: { name: inv.customerName! },
    resultKey: "customerSearch",
  };
  steps.push(searchStep);

  const searchStart = Date.now();
  const searchRes = await client.get("/v2/customer", { name: inv.customerName! });
  const searchDuration = Date.now() - searchStart;

  stepResults.push({
    stepNumber: stepNum,
    success: searchRes.status === 200,
    statusCode: searchRes.status,
    data: searchRes.data,
    duration: searchDuration,
  });

  // Try to extract customer from search results
  if (searchRes.status === 200 && searchRes.data) {
    const d = searchRes.data as Record<string, unknown>;
    const values = (d.values ?? d.fullResultSet?.values) as Record<string, unknown>[] | undefined;
    if (values && values.length > 0) {
      // Prefer exact name match
      const exact = values.find(
        (v) => String(v.name).toLowerCase() === inv.customerName!.toLowerCase()
      );
      const match = exact ?? values[0];
      customerId = match.id as number;
      log.info(`Found existing customer ID: ${customerId}`);
    }
  }

  // Create customer if not found
  if (!customerId) {
    stepNum++;
    log.info("Customer not found, creating...");

    const customerBody: Record<string, unknown> = {
      name: inv.customerName,
      isCustomer: true,
      isSupplier: false,
    };
    if (inv.customerEmail) customerBody.email = inv.customerEmail.trim();
    if (inv.customerPhone) customerBody.phoneNumber = inv.customerPhone;
    if (inv.customerOrgNr) customerBody.organizationNumber = inv.customerOrgNr;

    const createStep: ExecutionStep = {
      stepNumber: stepNum,
      description: `POST /v2/customer — create "${inv.customerName}"`,
      method: "POST",
      endpoint: "/v2/customer",
      body: customerBody,
      resultKey: "customerId",
    };
    steps.push(createStep);

    const createStart = Date.now();
    const createRes = await client.post("/v2/customer", customerBody);
    const createDuration = Date.now() - createStart;
    const createSuccess = createRes.status >= 200 && createRes.status < 300;

    stepResults.push({
      stepNumber: stepNum,
      success: createSuccess,
      statusCode: createRes.status,
      data: createRes.data,
      duration: createDuration,
      ...(!createSuccess && { error: `Customer creation failed: ${createRes.status}` }),
    });

    if (!createSuccess) {
      return { plan: { summary: "Invoice creation failed: could not create customer", steps }, stepResults, verified: false };
    }

    customerId = extractId(createRes.data);
    if (!customerId) {
      return {
        plan: { summary: "Invoice creation failed: no customer ID returned", steps },
        stepResults: [...stepResults, { stepNumber: stepNum, success: false, statusCode: 0, error: "No customer ID in response", duration: 0 }],
        verified: false,
      };
    }
    log.info(`Created customer ID: ${customerId}`);
  }

  // ── Step 2: Create order (Tripletex requires order before invoice) ──

  stepNum++;
  const orderLines = inv.lineItems.map((li) => ({
    description: li.description,
    count: li.quantity,
    unitCostCurrency: li.unitPrice,
    unitPriceExcludingVatCurrency: li.unitPrice,
    // TODO: vatType may be required — add VAT lookup if needed
    ...(li.vatTypeId ? { vatType: { id: li.vatTypeId } } : {}),
    ...(li.productId ? { product: { id: li.productId } } : {}),
  }));

  const orderBody: Record<string, unknown> = {
    customer: { id: customerId },
    deliveryDate: inv.invoiceDate,
    orderDate: inv.invoiceDate,
    orderLines,
    // TODO: receiver may be required in some Tripletex configs
  };

  const orderStep: ExecutionStep = {
    stepNumber: stepNum,
    description: `POST /v2/order — create order for invoice`,
    method: "POST",
    endpoint: "/v2/order",
    body: orderBody,
    resultKey: "orderId",
  };
  steps.push(orderStep);

  log.info("Creating order", { customerId, lineCount: orderLines.length });
  const orderStart = Date.now();
  const orderRes = await client.post("/v2/order", orderBody);
  const orderDuration = Date.now() - orderStart;
  const orderSuccess = orderRes.status >= 200 && orderRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success: orderSuccess,
    statusCode: orderRes.status,
    data: orderRes.data,
    duration: orderDuration,
    ...(!orderSuccess && { error: `Order creation failed: ${orderRes.status}` }),
  });

  if (!orderSuccess) {
    return { plan: { summary: "Invoice creation failed: could not create order", steps }, stepResults, verified: false };
  }

  const orderId = extractId(orderRes.data);
  if (!orderId) {
    return {
      plan: { summary: "Invoice creation failed: no order ID returned", steps },
      stepResults: [...stepResults, { stepNumber: stepNum, success: false, statusCode: 0, error: "No order ID in response", duration: 0 }],
      verified: false,
    };
  }
  log.info(`Created order ID: ${orderId}`);

  // ── Step 3: Create invoice from order ──

  stepNum++;
  const invoiceBody: Record<string, unknown> = {
    invoiceDate: inv.invoiceDate,
    invoiceDueDate: inv.dueDate,
    // TODO: confirm if Tripletex uses orderId or orders array
    orders: [{ id: orderId }],
    ...(inv.comment ? { comment: inv.comment } : {}),
  };

  // Tripletex invoice creation endpoint — uses :invoice action on order
  // Alternative: POST /v2/invoice with orders reference
  const invoiceStep: ExecutionStep = {
    stepNumber: stepNum,
    description: `PUT /v2/order/${orderId}/:invoice — create invoice from order`,
    method: "PUT",
    endpoint: `/v2/order/${orderId}/:invoice`,
    body: { invoiceDate: inv.invoiceDate, invoiceDueDate: inv.dueDate },
    resultKey: "invoiceId",
  };
  steps.push(invoiceStep);

  log.info("Creating invoice from order", { orderId });
  const invoiceStart = Date.now();
  const invoiceRes = await client.put(`/v2/order/${orderId}/:invoice`, {
    invoiceDate: inv.invoiceDate,
    invoiceDueDate: inv.dueDate,
  });
  const invoiceDuration = Date.now() - invoiceStart;
  const invoiceSuccess = invoiceRes.status >= 200 && invoiceRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success: invoiceSuccess,
    statusCode: invoiceRes.status,
    data: invoiceRes.data,
    duration: invoiceDuration,
    ...(!invoiceSuccess && { error: `Invoice creation failed: ${invoiceRes.status}` }),
  });

  if (!invoiceSuccess) {
    // Fallback: try POST /v2/invoice directly
    log.warn("Order-to-invoice failed, trying direct POST /v2/invoice");
    stepNum++;
    const directBody = {
      customer: { id: customerId },
      invoiceDate: inv.invoiceDate,
      invoiceDueDate: inv.dueDate,
      orders: [{ id: orderId }],
      ...(inv.comment ? { comment: inv.comment } : {}),
    };

    const directStep: ExecutionStep = {
      stepNumber: stepNum,
      description: `POST /v2/invoice — direct invoice creation (fallback)`,
      method: "POST",
      endpoint: "/v2/invoice",
      body: directBody,
      resultKey: "invoiceId",
    };
    steps.push(directStep);

    const directStart = Date.now();
    const directRes = await client.post("/v2/invoice", directBody);
    const directDuration = Date.now() - directStart;
    const directSuccess = directRes.status >= 200 && directRes.status < 300;

    stepResults.push({
      stepNumber: stepNum,
      success: directSuccess,
      statusCode: directRes.status,
      data: directRes.data,
      duration: directDuration,
      ...(!directSuccess && { error: `Direct invoice creation also failed: ${directRes.status}` }),
    });

    if (!directSuccess) {
      return { plan: { summary: "Invoice creation failed at both order-to-invoice and direct paths", steps }, stepResults, verified: false };
    }

    const invoiceId = extractId(directRes.data);
    log.info(`Invoice created via direct path, ID: ${invoiceId}`);
    return { plan: { summary: `Invoice created (direct) for ${inv.customerName}, ID: ${invoiceId}`, steps }, stepResults, verified: true };
  }

  const invoiceId = extractId(invoiceRes.data);
  log.info(`Invoice created from order, ID: ${invoiceId}`);

  return {
    plan: { summary: `Invoice created for ${inv.customerName}, order ${orderId} → invoice ${invoiceId}`, steps },
    stepResults,
    verified: true,
  };
}
