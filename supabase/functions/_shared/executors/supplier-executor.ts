// Supplier creation executor — same pattern as customer with isSupplier=true

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { validateCustomerFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeSupplierCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:supplier");
  const fields = parsed.fields ?? {};

  const name = (fields.name ?? fields.supplierName ?? fields.companyName ?? fields.leverandør ?? fields.proveedor ?? fields.Lieferant ?? fields.fournisseur) as string | undefined;
  const email = (fields.email ?? fields.emailAddress ?? fields.epost) as string | undefined;
  const phone = (fields.phoneNumber ?? fields.phone ?? fields.telefon) as string | undefined;
  const orgNr = (fields.organizationNumber ?? fields.orgNumber ?? fields.organisasjonsnummer) as string | undefined;
  const address = (fields.address ?? fields.adresse) as string | undefined;
  const postalCode = (fields.postalCode ?? fields.postnummer ?? fields.zipCode) as string | undefined;
  const city = (fields.city ?? fields.poststed ?? fields.by) as string | undefined;

  const normalizedFields: Record<string, unknown> = {
    name,
    ...(email && { email: email.trim() }),
    ...(phone && { phoneNumber: String(phone).trim() }),
    ...(orgNr && { organizationNumber: String(orgNr).trim() }),
  };

  const errors = validateCustomerFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    return {
      plan: { summary: "Supplier creation failed: validation errors", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
      verified: false,
    };
  }

  const body: Record<string, unknown> = {
    name: normalizedFields.name,
    isCustomer: false,
    isSupplier: true,
  };
  if (normalizedFields.email) body.email = normalizedFields.email;
  if (normalizedFields.phoneNumber) body.phoneNumber = normalizedFields.phoneNumber;
  if (normalizedFields.organizationNumber) body.organizationNumber = normalizedFields.organizationNumber;
  if (address || postalCode || city) {
    body.postalAddress = {
      ...(address && { addressLine1: address }),
      ...(postalCode && { postalCode }),
      ...(city && { city }),
    };
  }

  const plan: ExecutionPlan = {
    summary: `Create supplier: ${normalizedFields.name}`,
    steps: [{
      stepNumber: 1,
      description: `POST /v2/customer — create supplier "${normalizedFields.name}"`,
      method: "POST",
      endpoint: "/v2/customer",
      body,
      resultKey: "supplierId",
    }],
  };

  log.info("Executing supplier creation", { body });
  const start = Date.now();
  const response = await client.postWithRetry("/v2/customer", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  if (success) {
    const id = extractId(response.data);
    log.info(`Supplier created with ID ${id}`);
  }

  return {
    plan,
    stepResults: [{
      stepNumber: 1,
      success,
      statusCode: response.status,
      data: response.data,
      duration,
      ...(!success && { error: `Tripletex returned ${response.status}` }),
    }],
    verified: success,
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
