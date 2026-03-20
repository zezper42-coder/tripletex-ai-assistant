// Employee delete executor — search then delete
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEmployeeId, genericDelete, failResult } from "./shared-helpers.ts";

export async function executeEmployeeDelete(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:employee_delete");
  const f = parsed.fields ?? {};

  const { id, stepResult } = await resolveEmployeeId(client, log, f);
  const stepResults = stepResult ? [{ ...stepResult, stepNumber: 1 }] : [];

  if (!id) return failResult("Employee delete failed: could not resolve employee", "No employee found");

  log.info(`Deleting employee ${id}`);
  const del = await genericDelete(client, log, "/v2/employee", id);
  const delResults = del.stepResults.map(r => ({ ...r, stepNumber: stepResults.length + 1 }));

  return {
    plan: { summary: `Deleted employee ${id}`, steps: [] },
    stepResults: [...stepResults, ...delResults],
    verified: del.success,
  };
}
