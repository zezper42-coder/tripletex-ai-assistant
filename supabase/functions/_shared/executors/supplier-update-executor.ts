// Supplier update executor — GET + merge + PUT (uses /v2/customer with isSupplier)
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericUpdate, failResult, extractListValues } from "./shared-helpers.ts";

export async function executeSupplierUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:supplier_update");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.supplierName ?? f.leverandør ?? f.leverandørnavn) as string | undefined;
  const id = (f.id ?? f.supplierId) as number | undefined;

  // Suppliers are stored as customers with isSupplier=true
  let supplierId = id ? Number(id) : undefined;
  const stepResults: any[] = [];

  if (!supplierId && name) {
    const start = Date.now();
    const res = await client.get("/v2/customer", { name, isSupplier: "true", fields: "*", count: "5" });
    stepResults.push({ stepNumber: 1, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });
    const vals = extractListValues(res.data);
    const exact = vals.find(v => String(v.name).toLowerCase() === name.toLowerCase());
    supplierId = (exact?.id ?? vals[0]?.id) as number | undefined;
  }

  if (!supplierId) return failResult("Supplier update failed: not found", "No supplier found");

  const updateFields: Record<string, unknown> = {};
  const newEmail = (f.email ?? f.newEmail ?? f.epost) as string | undefined;
  const newPhone = (f.phoneNumber ?? f.phone ?? f.telefon) as string | undefined;
  const newName = (f.newName ?? f.updatedName) as string | undefined;
  const newOrgNr = (f.newOrganizationNumber ?? f.organizationNumber ?? f.orgNr) as string | undefined;
  const newUrl = (f.url ?? f.website ?? f.nettside) as string | undefined;
  const newAddress = (f.address ?? f.adresse) as string | undefined;
  const newPostalCode = (f.postalCode ?? f.postnummer) as string | undefined;
  const newCity = (f.city ?? f.poststed) as string | undefined;

  if (newEmail) updateFields.email = newEmail.trim();
  if (newPhone) updateFields.phoneNumber = String(newPhone).trim();
  if (newName) updateFields.name = newName;
  if (newOrgNr) updateFields.organizationNumber = newOrgNr;
  if (newUrl) updateFields.url = newUrl;
  if (newAddress || newPostalCode || newCity) {
    updateFields.postalAddress = {
      ...(newAddress && { addressLine1: newAddress }),
      ...(newPostalCode && { postalCode: newPostalCode }),
      ...(newCity && { city: newCity }),
    };
  }

  const update = await genericUpdate(client, log, "/v2/customer", supplierId, updateFields, ["name"]);
  const updateResults = update.stepResults.map((r, i) => ({ ...r, stepNumber: stepResults.length + i + 1 }));

  return {
    plan: { summary: `Supplier ${supplierId} updated`, steps: [] },
    stepResults: [...stepResults, ...updateResults],
    verified: update.success,
  };
}
