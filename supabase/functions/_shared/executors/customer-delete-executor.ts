// Customer delete executor
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeCustomerDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:customer_delete");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.customerName ?? f.kunde ?? f.kundenavn ?? f.companyName) as string | undefined;
  const id = (f.id ?? f.customerId) as number | undefined;
  const orgNr = (f.organizationNumber ?? f.orgNumber ?? f.orgNr) as string | undefined;

  const resolved = await resolveEntityId(client, "/v2/customer", { id: id ? Number(id) : undefined, name, orgNr }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Customer delete failed: not found", "No customer found");

  log.info(`Deleting customer ${resolved.id}`);
  const del = await genericDelete(client, log, "/v2/customer", resolved.id);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted customer ${resolved.id}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
