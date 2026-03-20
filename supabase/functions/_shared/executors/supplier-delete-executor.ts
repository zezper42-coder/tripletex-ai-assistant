// Supplier delete executor — uses /v2/supplier
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeSupplierDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:supplier_delete");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.supplierName ?? f.leverandør ?? f.leverandørnavn) as string | undefined;
  const id = (f.id ?? f.supplierId) as number | undefined;
  let supplierId = id ? Number(id) : undefined;
  const stepResults: any[] = [];

  if (!supplierId && name) {
    const start = Date.now();
    const res = await client.get("/v2/supplier", { name, fields: "id,name", count: "5" });
    stepResults.push({ stepNumber: 1, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });
    const vals = extractListValues(res.data);
    const exact = vals.find(v => String(v.name).toLowerCase() === name.toLowerCase());
    supplierId = (exact?.id ?? vals[0]?.id) as number | undefined;
  }

  if (!supplierId) return failResult("Supplier delete failed: not found", "No supplier found");

  log.info(`Deleting supplier ${supplierId}`);
  const del = await genericDelete(client, log, "/v2/supplier", supplierId);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted supplier ${supplierId}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
