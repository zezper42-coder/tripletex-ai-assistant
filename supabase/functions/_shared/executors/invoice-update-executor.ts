// Invoice update executor — resolve invoice then PUT
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, extractSingle, failResult } from "./shared-helpers.ts";

export async function executeInvoiceUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:invoice_update");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];
  let stepNum = 0;

  // Resolve invoice
  let invoiceId = (f.invoiceId ?? f.invoice_id ?? f.id) as number | undefined;
  const invoiceNumber = (f.invoiceNumber ?? f.invoice_number ?? f.fakturanummer) as string | undefined;
  const customerName = (f.customerName ?? f.customer ?? f.kunde) as string | undefined;

  if (!invoiceId) {
    stepNum++;
    const params: Record<string, string> = { fields: "*", count: "5" };
    if (invoiceNumber) params.invoiceNumber = String(invoiceNumber);
    if (customerName) params.customerName = String(customerName);

    const start = Date.now();
    const res = await client.get("/v2/invoice", params);
    stepResults.push({ stepNumber: stepNum, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });

    if (res.status === 200) {
      const vals = extractListValues(res.data);
      if (vals.length > 0) invoiceId = vals[0].id as number;
    }
  }

  if (!invoiceId) return failResult("Invoice update failed: not found", "No invoice found");

  // GET current
  stepNum++;
  const getStart = Date.now();
  const getRes = await client.get(`/v2/invoice/${invoiceId}`, { fields: "*" });
  stepResults.push({ stepNumber: stepNum, success: getRes.status === 200, statusCode: getRes.status, data: getRes.data, duration: Date.now() - getStart });
  if (getRes.status !== 200) return { plan: { summary: "Invoice GET failed", steps: [] }, stepResults, verified: false };

  const current = extractSingle(getRes.data) ?? {};
  const version = current.version as number | undefined;

  // Build update
  const body: Record<string, unknown> = { id: invoiceId };
  const newDueDate = (f.dueDate ?? f.invoiceDueDate ?? f.forfallsdato) as string | undefined;
  const newComment = (f.comment ?? f.kommentar) as string | undefined;

  if (newDueDate) body.invoiceDueDate = newDueDate;
  if (newComment) body.comment = newComment;
  if (version !== undefined) body.version = version;

  stepNum++;
  const putStart = Date.now();
  const putRes = await client.putWithRetry(`/v2/invoice/${invoiceId}`, body);
  const success = putRes.status >= 200 && putRes.status < 300;
  stepResults.push({ stepNumber: stepNum, success, statusCode: putRes.status, data: putRes.data, duration: Date.now() - putStart, ...(!success && { error: `PUT failed: ${putRes.status}` }) });

  return {
    plan: { summary: `Invoice ${invoiceId} updated`, steps: [] },
    stepResults,
    verified: success,
  };
}
