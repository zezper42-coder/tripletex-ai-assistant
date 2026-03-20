// Payment delete executor — resolve payment then DELETE
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, genericDelete, failResult } from "./shared-helpers.ts";

export async function executePaymentDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:payment_delete");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];

  let paymentId = (f.paymentId ?? f.payment_id ?? f.id) as number | undefined;
  const invoiceId = (f.invoiceId ?? f.invoice_id) as number | undefined;
  const customerName = (f.customerName ?? f.customer ?? f.kunde) as string | undefined;

  if (!paymentId) {
    // Search for payment by invoice
    const params: Record<string, string> = { fields: "*" };
    if (invoiceId) params.invoiceId = String(invoiceId);
    if (customerName) params.customerName = String(customerName);

    const start = Date.now();
    const res = await client.get("/v2/payment", params);
    stepResults.push({ stepNumber: 1, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });

    if (res.status === 200) {
      const vals = extractListValues(res.data);
      if (vals.length > 0) paymentId = vals[0].id as number;
    }
  }

  if (!paymentId) return failResult("Payment delete failed: not found", "No payment found");

  log.info(`Deleting payment ${paymentId}`);
  const del = await genericDelete(client, log, "/v2/payment", paymentId);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted payment ${paymentId}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
