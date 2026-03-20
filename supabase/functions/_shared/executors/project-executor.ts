// Project creation executor — deterministic, with customer auto-creation and required fields

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { validateProjectFields, ValidationError } from "../field-validation.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeProjectCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:project");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.projectName ?? f.prosjektnavn ?? f.nombre ?? f.Projektname ?? f.nom) as string | undefined;
  const projectNumber = (f.number ?? f.projectNumber ?? f.prosjektnummer) as string | undefined;
  const description = (f.description ?? f.beskrivelse ?? f.descripcion ?? f.Beschreibung) as string | undefined;
  const customerRef = (f.customer ?? f.customerName ?? f.kunde ?? f.kundenavn ?? f.cliente ?? f.Kunde ?? f.client) as string | undefined;
  const startDate = (f.startDate ?? f.startdato ?? f.fechaInicio ?? f.Startdatum ?? f.dateDebut) as string | undefined;
  const endDate = (f.endDate ?? f.sluttdato ?? f.fechaFin ?? f.Enddatum ?? f.dateFin) as string | undefined;

  // Customer fields that might be in the parsed task (for multi-resource tasks)
  const customerEmail = (f.customerEmail ?? f.email ?? f.epost) as string | undefined;
  const customerPhone = (f.customerPhone ?? f.phoneNumber ?? f.telefon ?? f.phone) as string | undefined;
  const customerOrgNr = (f.organizationNumber ?? f.orgNumber ?? f.organisasjonsnummer ?? f.customerOrgNumber ?? f.orgNr) as string | undefined;
  const customerAddress = (f.address ?? f.adresse) as string | undefined;
  const customerPostalCode = (f.postalCode ?? f.postnummer) as string | undefined;
  const customerCity = (f.city ?? f.poststed) as string | undefined;
  const customerCountry = (f.country ?? f.land) as string | undefined;

  const normalizedFields: Record<string, unknown> = {
    name,
    ...(projectNumber && { number: String(projectNumber).trim() }),
    ...(description && { description: String(description).trim() }),
    ...(customerRef && { customerRef: String(customerRef).trim() }),
  };

  const errors = validateProjectFields(normalizedFields);
  if (errors.length > 0) {
    log.error("Validation failed", { errors });
    return failedResult(errors, log);
  }

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let customerId: number | undefined;
  let stepCounter = 0;

  // If customer referenced, search for exact match first, then create if not found
  if (customerRef) {
    stepCounter++;
    steps.push({
      stepNumber: stepCounter,
      description: `GET /v2/customer — search for "${customerRef}"`,
      method: "GET",
      endpoint: "/v2/customer",
      queryParams: { name: customerRef },
      resultKey: "customerSearchResult",
    });

    log.info("Searching for customer", { customerRef });
    const start = Date.now();
    const searchResp = await client.get("/v2/customer", { name: customerRef });
    const duration = Date.now() - start;

    const searchSuccess = searchResp.status >= 200 && searchResp.status < 300;
    stepResults.push({
      stepNumber: stepCounter,
      success: searchSuccess,
      statusCode: searchResp.status,
      data: searchResp.data,
      duration,
    });

    if (searchSuccess) {
      const customers = extractListValues(searchResp.data);
      const exact = customers.find(
        (c: Record<string, unknown>) =>
          String(c.name).toLowerCase() === customerRef.toLowerCase()
      );
      if (exact) {
        customerId = exact.id as number;
        log.info(`Found exact customer match ID ${customerId}`);
      } else if (customers.length === 1) {
        customerId = customers[0].id as number;
        log.info(`Found single customer ID ${customerId}`);
      }
    }

    // Auto-create customer if not found
    if (!customerId) {
      stepCounter++;
      const customerBody: Record<string, unknown> = {
        name: customerRef,
        isCustomer: true,
        isSupplier: false,
      };
      if (customerEmail) customerBody.email = customerEmail;
      if (customerPhone) customerBody.phoneNumber = customerPhone;
      if (customerOrgNr) customerBody.organizationNumber = customerOrgNr;

      // Add address if available
      if (customerAddress || customerPostalCode || customerCity || customerCountry) {
        const addrObj: Record<string, unknown> = {};
        if (customerAddress) addrObj.addressLine1 = customerAddress;
        if (customerPostalCode) addrObj.postalCode = customerPostalCode;
        if (customerCity) addrObj.city = customerCity;
        if (customerCountry) {
          const cl = String(customerCountry).toLowerCase();
          addrObj.country = { id: ["norge", "norway", "no", "nor"].includes(cl) ? 161 : 0 };
        }
        customerBody.postalAddress = addrObj;
      }

      log.info("Customer not found, creating", { customerBody });
      steps.push({
        stepNumber: stepCounter,
        description: `POST /v2/customer — create "${customerRef}"`,
        method: "POST",
        endpoint: "/v2/customer",
        body: customerBody,
        resultKey: "customerId",
      });

      const cStart = Date.now();
      const createResp = await client.postWithRetry("/v2/customer", customerBody);
      const cDuration = Date.now() - cStart;
      const cSuccess = createResp.status >= 200 && createResp.status < 300;

      stepResults.push({
        stepNumber: stepCounter,
        success: cSuccess,
        statusCode: createResp.status,
        data: createResp.data,
        duration: cDuration,
        ...(!cSuccess && { error: `Customer creation failed: ${createResp.status}` }),
      });

      if (cSuccess) {
        customerId = extractId(createResp.data);
        log.info(`Customer created with ID ${customerId}`);
      } else {
        log.warn("Customer creation failed, continuing without customer link");
      }
    }
  }

  // Tripletex requires projectManager — look up first employee
  let projectManagerId: number | undefined;
  const pmField = (f.projectManager ?? f.prosjektleder ?? f.projectManagerId ?? f.prosjektleiar) as string | number | undefined;
  if (pmField && typeof pmField === "number") {
    projectManagerId = pmField;
  } else if (pmField && typeof pmField === "string") {
    const parts = pmField.trim().split(/\s+/);
    const searchParams: Record<string, string> = { firstName: parts[0], count: "1", fields: "id" };
    if (parts.length > 1) searchParams.lastName = parts.slice(1).join(" ");
    const empSearch = await client.get("/v2/employee", searchParams);
    if (empSearch.status === 200) {
      const vals = extractListValues(empSearch.data);
      if (vals.length > 0) projectManagerId = vals[0].id as number;
    }
  }
  if (!projectManagerId) {
    const empList = await client.get("/v2/employee", { count: "1", fields: "id" });
    if (empList.status === 200) {
      const vals = extractListValues(empList.data);
      if (vals.length > 0) projectManagerId = vals[0].id as number;
    }
  }
  if (projectManagerId) {
    log.info(`Using project manager employee ID ${projectManagerId}`);
  }

  // Default startDate to today if not provided — Tripletex REQUIRES it
  const today = new Date().toISOString().slice(0, 10);

  const body: Record<string, unknown> = {
    name: normalizedFields.name,
    startDate: startDate || today,
    ...(projectManagerId && { projectManager: { id: projectManagerId } }),
  };
  if (endDate) body.endDate = endDate;
  if (normalizedFields.number) body.number = normalizedFields.number;
  if (normalizedFields.description) body.description = normalizedFields.description;
  if (customerId) body.customer = { id: customerId };

  stepCounter++;
  steps.push({
    stepNumber: stepCounter,
    description: `POST /v2/project — create "${normalizedFields.name}"`,
    method: "POST",
    endpoint: "/v2/project",
    body,
    resultKey: "projectId",
  });

  const plan: ExecutionPlan = {
    summary: `Create project: ${normalizedFields.name}${customerId ? ` (linked to customer ${customerId})` : ""}`,
    steps,
  };

  log.info("Executing project creation", { body });
  const start = Date.now();
  const response = await client.postWithRetry("/v2/project", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  stepResults.push({
    stepNumber: stepCounter,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(!success && { error: `Tripletex returned ${response.status}` }),
  });

  if (success) {
    const id = extractId(response.data);
    log.info(`Project created with ID ${id}`);
  }

  return { plan, stepResults, verified: success };
}

function extractListValues(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.values)) return d.values as Record<string, unknown>[];
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  return [];
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
  logger.error("Project creation aborted due to validation errors");
  return {
    plan: { summary: "Project creation failed: validation errors", steps: [] },
    stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: errorMsg, duration: 0 }],
    verified: false,
  };
}
