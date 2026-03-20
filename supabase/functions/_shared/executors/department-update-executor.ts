// Department update executor — GET + merge + PUT
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { resolveEntityId, genericUpdate, failResult } from "./shared-helpers.ts";

export async function executeDepartmentUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:department_update");
  const f = parsed.fields ?? {};

  const name = (f.name ?? f.departmentName ?? f.avdelingsnavn) as string | undefined;
  const id = (f.id ?? f.departmentId) as number | undefined;

  const resolved = await resolveEntityId(client, "/v2/department", { id: id ? Number(id) : undefined, name }, log);
  const stepResults = resolved.stepResult.statusCode ? [{ ...resolved.stepResult, stepNumber: 1 }] : [];

  if (!resolved.id) return failResult("Department update failed: not found", "No department found");

  const updateFields: Record<string, unknown> = {};
  const newName = (f.newName ?? f.updatedName) as string | undefined;
  const newNumber = (f.departmentNumber ?? f.number ?? f.newNumber) as string | undefined;
  const managerId = (f.managerId ?? f.departmentManager ?? f.avdelingsleder) as number | string | undefined;

  if (newName) updateFields.name = newName;
  if (newNumber) updateFields.departmentNumber = String(newNumber);
  if (managerId) updateFields.departmentManager = { id: Number(managerId) };

  const update = await genericUpdate(client, log, "/v2/department", resolved.id, updateFields, ["name"]);
  const updateResults = update.stepResults.map((r, i) => ({ ...r, stepNumber: stepResults.length + i + 1 }));

  return {
    plan: { summary: `Department ${resolved.id} updated`, steps: [] },
    stepResults: [...stepResults, ...updateResults],
    verified: update.success,
  };
}
