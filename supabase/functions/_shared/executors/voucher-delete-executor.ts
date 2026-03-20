// Voucher delete executor
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeVoucherDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:voucher_delete");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];

  let voucherId = (f.voucherId ?? f.voucher_id ?? f.id) as number | undefined;
  const voucherNumber = (f.voucherNumber ?? f.bilagsnummer ?? f.number) as string | undefined;
  const date = (f.date ?? f.dato) as string | undefined;

  if (!voucherId) {
    const params: Record<string, string> = { fields: "id,number,date", count: "10" };
    if (voucherNumber) params.number = String(voucherNumber);
    if (date) { params.dateFrom = date; params.dateTo = date; }

    const start = Date.now();
    const res = await client.get("/v2/ledger/voucher", params);
    stepResults.push({ stepNumber: 1, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });

    if (res.status === 200) {
      const vals = extractListValues(res.data);
      if (vals.length > 0) voucherId = vals[0].id as number;
    }
  }

  if (!voucherId) return failResult("Voucher delete failed: not found", "No voucher found");

  log.info(`Deleting voucher ${voucherId}`);
  const del = await genericDelete(client, log, "/v2/ledger/voucher", voucherId);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted voucher ${voucherId}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
