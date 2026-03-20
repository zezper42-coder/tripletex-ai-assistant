// Contact update executor — GET + merge + PUT
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, genericUpdate, failResult } from "./shared-helpers.ts";

export async function executeContactUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:contact_update");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];

  let contactId = (f.contactId ?? f.id) as number | undefined;
  const contactName = (f.name ?? f.contactName ?? f.kontaktperson) as string | undefined;
  const contactEmail = (f.email ?? f.epost ?? f.contactEmail) as string | undefined;

  if (!contactId && (contactName || contactEmail)) {
    const params: Record<string, string> = { fields: "*", count: "5" };
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

  if (!contactId) return failResult("Contact update failed: not found", "No contact found");

  const updateFields: Record<string, unknown> = {};
  const newEmail = (f.newEmail ?? f.email ?? f.epost) as string | undefined;
  const newPhone = (f.phoneNumber ?? f.phone ?? f.telefon) as string | undefined;
  const newFirstName = (f.firstName ?? f.newFirstName) as string | undefined;
  const newLastName = (f.lastName ?? f.newLastName) as string | undefined;

  if (newEmail) updateFields.email = newEmail.trim();
  if (newPhone) updateFields.phoneNumber = String(newPhone).trim();
  if (newFirstName) updateFields.firstName = newFirstName;
  if (newLastName) updateFields.lastName = newLastName;

  const update = await genericUpdate(client, log, "/v2/contact", contactId, updateFields, ["firstName", "lastName"]);
  const updateResults = update.stepResults.map((r, i) => ({ ...r, stepNumber: stepResults.length + i + 1 }));

  return {
    plan: { summary: `Contact ${contactId} updated`, steps: [] },
    stepResults: [...stepResults, ...updateResults],
    verified: update.success,
  };
}
