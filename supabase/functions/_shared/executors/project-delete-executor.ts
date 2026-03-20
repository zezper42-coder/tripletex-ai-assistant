// Project delete executor
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeProjectDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:project_delete");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.projectName ?? f.prosjektnavn) as string | undefined;
  const id = (f.id ?? f.projectId) as number | undefined;

  const resolved = await resolveEntityId(client, "/v2/project", { id: id ? Number(id) : undefined, name }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Project delete failed: not found", "No project found");

  log.info(`Deleting project ${resolved.id}`);
  const del = await genericDelete(client, log, "/v2/project", resolved.id);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted project ${resolved.id}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
