// Customer creation executor — deterministic, no LLM in execution path

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { validateCustomerFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeCustomerCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:customer");
  const fields = parsed.fields ?? {};

  // Normalize field names — comprehensive multilingual alias mapping
  const name = (fields.name ?? fields.customerName ?? fields.companyName ?? fields.kunde ?? fields.kundenavn ?? fields.firmanavn ?? fields.empresa ?? fields.Firmenname ?? fields.nom) as string | undefined;
  const email = (fields.email ?? fields.emailAddress ?? fields.epost ?? fields.correo ?? fields.Email ?? fields.courriel ?? fields.customerEmail) as string | undefined;
  const phone = (fields.phoneNumber ?? fields.phone ?? fields.telefon ?? fields.teléfono ?? fields.Telefon ?? fields.téléphone ?? fields.customerPhone ?? fields.phoneNumberMobile) as string | undefined;
  const orgNr = (fields.organizationNumber ?? fields.orgNumber ?? fields.organisasjonsnummer ?? fields.orgNr ?? fields.orgnr) as string | undefined;
  const invoiceEmail = (fields.invoiceEmail ?? fields.fakturaEpost ?? fields.invoiceMail) as string | undefined;
  const address = (fields.address ?? fields.adresse ?? fields.addressLine1 ?? fields.streetAddress ?? fields.gateadresse ?? fields.dirección ?? fields.Adresse ?? fields.adresse_postale) as string | undefined;
  const postalCode = (fields.postalCode ?? fields.postnummer ?? fields.zipCode ?? fields.zip ?? fields.códigoPostal ?? fields.PLZ ?? fields.codePostal) as string | undefined;
  const city = (fields.city ?? fields.poststed ?? fields.by ?? fields.ciudad ?? fields.Stadt ?? fields.ville) as string | undefined;
  const country = (fields.country ?? fields.land ?? fields.país ?? fields.Land ?? fields.pays) as string | undefined;
  const url = (fields.url ?? fields.website ?? fields.nettside ?? fields.webside ?? fields.sitioWeb ?? fields.Webseite ?? fields.siteWeb) as string | undefined;
  const accountManager = (fields.accountManager ?? fields.kundeansvarlig ?? fields.kundekontakt) as string | undefined;

  const normalizedFields: Record<string, unknown> = {
    name,
    ...(email && { email: email.trim() }),
    ...(phone && { phoneNumber: String(phone).trim() }),
    ...(orgNr && { organizationNumber: String(orgNr).trim() }),
    ...(invoiceEmail && { invoiceEmail: invoiceEmail.trim() }),
  };

  // Validate before calling API
  const errors = validateCustomerFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, log);
  }

  const body: Record<string, unknown> = {
    name: normalizedFields.name,
    isCustomer: true,
    isSupplier: false,
  };
  if (normalizedFields.email) body.email = normalizedFields.email;
  if (normalizedFields.phoneNumber) body.phoneNumber = normalizedFields.phoneNumber;
  if (normalizedFields.organizationNumber) body.organizationNumber = normalizedFields.organizationNumber;
  if (normalizedFields.invoiceEmail) body.invoiceEmail = normalizedFields.invoiceEmail;
  if (url) body.website = url;

  // Add postal address if provided (Tripletex uses postalAddress, NOT address)
  if (address || postalCode || city || country) {
    const addressObj: Record<string, unknown> = {};
    if (address) addressObj.addressLine1 = address;
    if (postalCode) addressObj.postalCode = postalCode;
    if (city) addressObj.city = city;
    if (country) {
      // Norway = country ID 161
      const countryLower = String(country).toLowerCase();
      const isNorway = ["norge", "norway", "no", "nor"].includes(countryLower);
      addressObj.country = { id: isNorway ? 161 : 0 };
    }
    body.postalAddress = addressObj;
  }

  // Resolve account manager if specified
  if (accountManager) {
    const parts = String(accountManager).trim().split(/\s+/);
    const searchParams: Record<string, string> = { firstName: parts[0], count: "1", fields: "id" };
    if (parts.length > 1) searchParams.lastName = parts.slice(1).join(" ");
    const empRes = await client.get("/v2/employee", searchParams);
    if (empRes.status === 200) {
      const vals = ((empRes.data as any)?.values ?? []) as Array<{ id: number }>;
      if (vals.length > 0) body.accountManager = { id: vals[0].id };
    }
  }

  const plan: ExecutionPlan = {
    summary: `Create customer: ${normalizedFields.name}`,
    steps: [
      {
        stepNumber: 1,
        description: `POST /v2/customer — create "${normalizedFields.name}"`,
        method: "POST",
        endpoint: "/v2/customer",
        body,
        resultKey: "customerId",
      },
    ],
  };

  log.info("Executing customer creation", { body });
  const start = Date.now();

  const response = await client.postWithRetry("/v2/customer", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  const stepResult: StepResult = {
    stepNumber: 1,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(! success && { error: `Tripletex returned ${response.status}` }),
  };

  if (success) {
    const id = extractId(response.data);
    log.info(`Customer created with ID ${id}`);
  }

  return {
    plan,
    stepResults: [stepResult],
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

function failedResult(errors: ValidationError[], logger: Logger): ExecutorResult {
  const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
  logger.error("Customer creation aborted due to validation errors");
  return {
    plan: { summary: "Customer creation failed: validation errors", steps: [] },
    stepResults: [{
      stepNumber: 0,
      success: false,
      statusCode: 0,
      error: errorMsg,
      duration: 0,
    }],
    verified: false,
  };
}
