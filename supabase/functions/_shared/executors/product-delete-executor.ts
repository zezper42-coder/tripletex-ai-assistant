// Product delete executor
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeProductDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:product_delete");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.productName ?? f.produktnavn) as string | undefined;
  const id = (f.id ?? f.productId) as number | undefined;

  const resolved = await resolveEntityId(client, "/v2/product", { id: id ? Number(id) : undefined, name }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Product delete failed: not found", "No product found");

  log.info(`Deleting product ${resolved.id}`);
  const del = await genericDelete(client, log, "/v2/product", resolved.id);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted product ${resolved.id}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
