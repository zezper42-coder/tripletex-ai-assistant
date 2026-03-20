// Department delete executor
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeDepartmentDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:department_delete");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.departmentName ?? f.avdelingsnavn) as string | undefined;
  const id = (f.id ?? f.departmentId) as number | undefined;

  const resolved = await resolveEntityId(client, "/v2/department", { id: id ? Number(id) : undefined, name }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Department delete failed: not found", "No department found");

  log.info(`Deleting department ${resolved.id}`);
  const del = await genericDelete(client, log, "/v2/department", resolved.id);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted department ${resolved.id}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
