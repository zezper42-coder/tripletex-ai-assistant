// Product creation executor — deterministic, no LLM in execution path

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { validateProductFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";
import { VatTypeLookup } from "../vat-lookup.ts";

export async function executeProductCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:product");
  const f = parsed.fields;

  // Normalize field aliases
  const name = (f.name ?? f.productName ?? f.produktnavn ?? f.nombre) as string | undefined;
  const number = (f.number ?? f.productNumber ?? f.code ?? f.produktnummer) as string | undefined;
  const price = (f.price ?? f.priceExcludingVatCurrency ?? f.pris ?? f.precio ?? f.prix) as number | string | undefined;
  const description = (f.description ?? f.beskrivelse ?? f.descripcion ?? f.Beschreibung) as string | undefined;
  const vatRate = (f.vatRate ?? f.mvaRate ?? f.vat ?? f.mva) as number | undefined;
  const vatCode = (f.vatCode ?? f.mvaCode ?? f.vatNumber) as number | undefined;
  let vatTypeId = (f.vatTypeId ?? f.vatType ?? f.mvaType) as number | undefined;

  // VAT lookup if rate/code provided but no explicit ID
  if (!vatTypeId && (vatRate != null || vatCode != null)) {
    const vatLookup = new VatTypeLookup(client, logger);
    const resolved = await vatLookup.resolve({ rate: vatRate ? Number(vatRate) : undefined, code: vatCode ? Number(vatCode) : undefined });
    if (resolved) {
      vatTypeId = resolved.id;
      log.info("VAT type resolved", { vatTypeId, name: resolved.name, percentage: resolved.percentage });
    } else {
      log.warn("VAT type not resolved, proceeding without", { vatRate, vatCode });
    }
  }

  const normalizedFields: Record<string, unknown> = {
    name,
    ...(number && { number: String(number).trim() }),
    ...(price !== undefined && { priceExcludingVatCurrency: Number(price) }),
    ...(description && { description: String(description).trim() }),
    ...(vatTypeId !== undefined && { vatType: { id: Number(vatTypeId) } }),
  };

  const errors = validateProductFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, log);
  }

  const body: Record<string, unknown> = {
    name: normalizedFields.name,
    ...(normalizedFields.number && { number: normalizedFields.number }),
    ...(normalizedFields.priceExcludingVatCurrency !== undefined && {
      priceExcludingVatCurrency: normalizedFields.priceExcludingVatCurrency,
    }),
    ...(normalizedFields.description && { description: normalizedFields.description }),
    ...(normalizedFields.vatType && { vatType: normalizedFields.vatType }),
  };

  const plan: ExecutionPlan = {
    summary: `Create product: ${normalizedFields.name}`,
    steps: [{
      stepNumber: 1,
      description: `POST /v2/product — create "${normalizedFields.name}"`,
      method: "POST",
      endpoint: "/v2/product",
      body,
      resultKey: "productId",
    }],
  };

  log.info("Executing product creation", { body });
  const start = Date.now();
  const response = await client.post("/v2/product", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  const stepResult: StepResult = {
    stepNumber: 1,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(!success && { error: `Tripletex returned ${response.status}` }),
  };

  let verified = false;
  if (success) {
    const id = extractId(response.data);
    if (id) {
      log.info(`Product created with ID ${id}, verifying...`);
      try {
        const check = await client.get(`/v2/product/${id}`);
        verified = check.status === 200;
        log.info(`Verification: ${verified ? "passed" : "failed"}`);
      } catch (err) {
        log.warn("Verification request failed", { error: String(err) });
      }
    }
  }

  return { plan, stepResults: [stepResult], verified };
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
  logger.error("Product creation aborted due to validation errors");
  return {
    plan: { summary: "Product creation failed: validation errors", steps: [] },
    stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
    verified: false,
  };
}
