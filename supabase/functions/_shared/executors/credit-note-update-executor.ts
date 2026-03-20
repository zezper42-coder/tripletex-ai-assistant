// Credit note update executor — typically updates comment/metadata on existing credit note
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, extractSingle, failResult } from "./shared-helpers.ts";

export async function executeCreditNoteUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:creditNote_update");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];
  let stepNum = 0;

  // Credit notes are invoices with isCreditNote=true
  let invoiceId = (f.creditNoteId ?? f.invoiceId ?? f.id) as number | undefined;
  const invoiceNumber = (f.invoiceNumber ?? f.creditNoteNumber) as string | undefined;

  if (!invoiceId && invoiceNumber) {
    stepNum++;
    const start = Date.now();
    const res = await client.get("/v2/invoice", { invoiceNumber: String(invoiceNumber), fields: "*" });
    stepResults.push({ stepNumber: stepNum, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });
    const vals = extractListValues(res.data);
    if (vals.length > 0) invoiceId = vals[0].id as number;
  }

  if (!invoiceId) return failResult("Credit note update failed: not found", "No credit note found");

  // GET current
  stepNum++;
  const getStart = Date.now();
  const getRes = await client.get(`/v2/invoice/${invoiceId}`, { fields: "*" });
  stepResults.push({ stepNumber: stepNum, success: getRes.status === 200, statusCode: getRes.status, data: getRes.data, duration: Date.now() - getStart });
  if (getRes.status !== 200) return { plan: { summary: "Credit note GET failed", steps: [] }, stepResults, verified: false };

  const current = extractSingle(getRes.data) ?? {};
  const version = current.version as number | undefined;

  const body: Record<string, unknown> = { id: invoiceId };
  const newComment = (f.comment ?? f.reason ?? f.kommentar) as string | undefined;
  if (newComment) body.comment = newComment;
  if (version !== undefined) body.version = version;

  stepNum++;
  const putStart = Date.now();
  const putRes = await client.putWithRetry(`/v2/invoice/${invoiceId}`, body);
  const success = putRes.status >= 200 && putRes.status < 300;
  stepResults.push({ stepNumber: stepNum, success, statusCode: putRes.status, data: putRes.data, duration: Date.now() - putStart });

  return {
    plan: { summary: `Credit note ${invoiceId} updated`, steps: [] },
    stepResults,
    verified: success,
  };
}
