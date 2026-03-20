// Contact delete executor
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeContactDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:contact_delete");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];

  let contactId = (f.contactId ?? f.id) as number | undefined;
  const contactName = (f.name ?? f.contactName ?? f.kontaktperson) as string | undefined;
  const contactEmail = (f.email ?? f.epost) as string | undefined;

  if (!contactId && (contactName || contactEmail)) {
    const params: Record<string, string> = { fields: "id,firstName,lastName,email", count: "5" };
    if (contactEmail) params.email = contactEmail;
    if (contactName) {
      const parts = contactName.trim().split(/\s+/);
      params.firstName = parts[0];
      if (parts.length > 1) params.lastName = parts.slice(1).join(" ");
    }

    const start = Date.now();
    const res = await client.get("/v2/contact", params);
    stepResults.push({ stepNumber: 1, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });
    const vals = extractListValues(res.data);
    if (vals.length > 0) contactId = vals[0].id as number;
  }

  if (!contactId) return failResult("Contact delete failed: not found", "No contact found");

  log.info(`Deleting contact ${contactId}`);
  const del = await genericDelete(client, log, "/v2/contact", contactId);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted contact ${contactId}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
