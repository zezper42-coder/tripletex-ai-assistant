// Product update executor — GET + merge + PUT
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericUpdate, failResult } from "./shared-helpers.ts";

export async function executeProductUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:product_update");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.productName ?? f.produktnavn) as string | undefined;
  const id = (f.id ?? f.productId) as number | undefined;

  const resolved = await resolveEntityId(client, "/v2/product", { id: id ? Number(id) : undefined, name }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Product update failed: not found", "No product found");

  const updateFields: Record<string, unknown> = {};
  const newName = (f.newName ?? f.updatedName) as string | undefined;
  const newPrice = (f.price ?? f.priceExcludingVatCurrency ?? f.pris ?? f.newPrice) as number | string | undefined;
  const newCost = (f.cost ?? f.costExcludingVatCurrency ?? f.innkjøpspris ?? f.newCost) as number | string | undefined;
  const newDescription = (f.description ?? f.beskrivelse ?? f.newDescription) as string | undefined;
  const newNumber = (f.number ?? f.productNumber ?? f.newNumber) as string | undefined;
  const isInactive = f.isInactive as boolean | undefined;

  if (newName) updateFields.name = newName;
  if (newPrice !== undefined) updateFields.priceExcludingVatCurrency = Number(newPrice);
  if (newCost !== undefined) updateFields.costExcludingVatCurrency = Number(newCost);
  if (newDescription) updateFields.description = newDescription;
  if (newNumber) updateFields.number = String(newNumber);
  if (isInactive !== undefined) updateFields.isInactive = isInactive;

  const update = await genericUpdate(client, log, "/v2/product", resolved.id, updateFields, ["name"]);
  const updateResults = update.stepResults.map((r, i) => ({ ...r, stepNumber: stepResults.length + i + 1 }));

  return {
    plan: { summary: `Product ${resolved.id} updated`, steps: [] },
    stepResults: [...stepResults, ...updateResults],
    verified: update.success,
  };
}
