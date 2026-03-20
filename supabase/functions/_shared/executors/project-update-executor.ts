// Project update executor — GET + merge + PUT
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericUpdate, failResult } from "./shared-helpers.ts";

export async function executeProjectUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:project_update");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.projectName ?? f.prosjektnavn) as string | undefined;
  const id = (f.id ?? f.projectId) as number | undefined;

  const resolved = await resolveEntityId(client, "/v2/project", { id: id ? Number(id) : undefined, name }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Project update failed: not found", "No project found");

  const updateFields: Record<string, unknown> = {};
  const newName = (f.newName ?? f.updatedName) as string | undefined;
  const newDescription = (f.description ?? f.beskrivelse ?? f.newDescription) as string | undefined;
  const newEndDate = (f.endDate ?? f.sluttdato) as string | undefined;
  const newStartDate = (f.startDate ?? f.startdato) as string | undefined;

  if (newName) updateFields.name = newName;
  if (newDescription) updateFields.description = newDescription;
  if (newEndDate) updateFields.endDate = newEndDate;
  if (newStartDate) updateFields.startDate = newStartDate;

  const update = await genericUpdate(client, log, "/v2/project", resolved.id, updateFields, ["name"]);
  const updateResults = update.stepResults.map((r, i) => ({ ...r, stepNumber: stepResults.length + i + 1 }));

  return {
    plan: { summary: `Project ${resolved.id} updated`, steps: [] },
    stepResults: [...stepResults, ...updateResults],
    verified: update.success,
  };
}
