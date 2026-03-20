// Customer update executor — GET + merge + PUT with version

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan, ExecutionStep } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeCustomerUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:customer_update");
  const f = parsed.fields ?? {};

  const steps: ExecutionStep[] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  // Resolve customer by ID, name, or org number
  let customerId = (f.id ?? f.customerId ?? f.customer_id) as number | undefined;
  const customerName = (f.name ?? f.customerName ?? f.kunde ?? f.kundenavn) as string | undefined;
  const orgNr = (f.organizationNumber ?? f.orgNumber) as string | undefined;

  if (!customerId && (customerName || orgNr)) {
    stepNum++;
    const params: Record<string, string> = { fields: "*", count: "5" };
    if (customerName) params.name = customerName;
    if (orgNr) params.organizationNumber = orgNr;

    const searchRes = await client.get("/v2/customer", params);
    stepResults.push({ stepNumber: stepNum, success: searchRes.status === 200, statusCode: searchRes.status, data: searchRes.data, duration: 0 });

    if (searchRes.status === 200) {
      const vals = ((searchRes.data as any)?.values ?? []) as Record<string, unknown>[];
      if (vals.length === 1) {
        customerId = vals[0].id as number;
      } else if (vals.length > 1 && customerName) {
        const exact = vals.find(v => String(v.name).toLowerCase() === customerName.toLowerCase());
        if (exact) customerId = exact.id as number;
      }
    }
  }

  if (!customerId) {
    return {
      plan: { summary: "Customer update failed: could not resolve customer", steps },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: "No customer found", duration: 0 }],
      verified: false,
    };
  }

  // GET current state
  stepNum++;
  const getRes = await client.get(`/v2/customer/${customerId}`, { fields: "*" });
  stepResults.push({ stepNumber: stepNum, success: getRes.status === 200, statusCode: getRes.status, data: getRes.data, duration: 0 });

  if (getRes.status !== 200) {
    return { plan: { summary: "Customer update failed: GET failed", steps }, stepResults, verified: false };
  }

  const current = ((getRes.data as any)?.value ?? getRes.data) as Record<string, unknown>;
  const version = current.version as number | undefined;

  // Build update body — merge new fields into current but only send minimum required to avoid 422
  const updateBody: Record<string, unknown> = {
    id: customerId,
    name: current.name, // Required field
  };
  const newEmail = (f.email ?? f.emailAddress ?? f.epost) as string | undefined;
  const newPhone = (f.phoneNumber ?? f.phone ?? f.telefon) as string | undefined;
  const newInvoiceEmail = (f.invoiceEmail ?? f.fakturaEpost) as string | undefined;
  const newAddress = (f.address ?? f.adresse) as string | undefined;
  const newPostalCode = (f.postalCode ?? f.postnummer) as string | undefined;
  const newCity = (f.city ?? f.poststed) as string | undefined;
  const newName = (f.newName ?? f.updatedName) as string | undefined;

  if (newEmail) updateBody.email = newEmail.trim();
  if (newPhone) updateBody.phoneNumber = String(newPhone).trim();
  if (newInvoiceEmail) updateBody.invoiceEmail = newInvoiceEmail.trim();
  if (newName) updateBody.name = newName;
  if (version !== undefined) updateBody.version = version;

  if (newAddress || newPostalCode || newCity) {
    const existing = (current.postalAddress ?? {}) as Record<string, unknown>;
    updateBody.postalAddress = {
      ...existing,
      ...(newAddress && { addressLine1: newAddress }),
      ...(newPostalCode && { postalCode: newPostalCode }),
      ...(newCity && { city: newCity }),
    };
  }

  // PUT update
  stepNum++;
  steps.push({
    stepNumber: stepNum,
    description: `PUT /v2/customer/${customerId} — update`,
    method: "PUT",
    endpoint: `/v2/customer/${customerId}`,
    body: updateBody,
    resultKey: "updatedCustomer",
  });

  log.info("Updating customer", { customerId });
  const start = Date.now();
  const putRes = await client.put(`/v2/customer/${customerId}`, updateBody);
  const duration = Date.now() - start;
  const success = putRes.status >= 200 && putRes.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success,
    statusCode: putRes.status,
    data: putRes.data,
    duration,
    ...(!success && { error: `Update failed: ${putRes.status}` }),
  });

  return {
    plan: { summary: `Customer ${customerId} updated`, steps },
    stepResults,
    verified: success,
  };
}
