// Travel expense update executor — GET + merge + PUT
import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";
import { extractListValues, extractSingle, resolveEmployeeId, failResult } from "./shared-helpers.ts";

export async function executeTravelExpenseUpdate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:travelExpense_update");
  const f = parsed.fields ?? {};
  const stepResults: any[] = [];
  let stepNum = 0;

  let expenseId = (f.travelExpenseId ?? f.expenseId ?? f.id) as number | undefined;
  const empName = (f.employeeName ?? f.employee ?? f.ansatt) as string | undefined;

  // Search by employee if no direct ID
  if (!expenseId && empName) {
    const empResolved = await resolveEmployeeId(client, log, f);
    if (empResolved.stepResult) stepResults.push({ ...empResolved.stepResult, stepNumber: ++stepNum });

    if (empResolved.id) {
      const start = Date.now();
      const res = await client.get("/v2/travelExpense", { employeeId: String(empResolved.id), fields: "*", count: "5" });
      stepResults.push({ stepNumber: ++stepNum, success: res.status === 200, statusCode: res.status, data: res.data, duration: Date.now() - start });

      const vals = extractListValues(res.data);
      if (vals.length > 0) expenseId = vals[0].id as number;
    }
  }

  if (!expenseId) return failResult("Travel expense update failed: not found", "No travel expense found");

  // GET current
  stepNum++;
  const getStart = Date.now();
  const getRes = await client.get(`/v2/travelExpense/${expenseId}`, { fields: "*" });
  stepResults.push({ stepNumber: stepNum, success: getRes.status === 200, statusCode: getRes.status, data: getRes.data, duration: Date.now() - getStart });
  if (getRes.status !== 200) return { plan: { summary: "Travel expense GET failed", steps: [] }, stepResults, verified: false };

  const current = extractSingle(getRes.data) ?? {};
  const version = current.version as number | undefined;

  const body: Record<string, unknown> = { id: expenseId };
  const newTitle = (f.title ?? f.purpose ?? f.formål) as string | undefined;
  const newDescription = (f.description ?? f.beskrivelse) as string | undefined;
  const newDepartureDate = (f.departureDate ?? f.travelDate ?? f.dato) as string | undefined;
  const newDestination = (f.destination ?? f.til) as string | undefined;

  if (newTitle) body.title = newTitle;
  if (newDescription) body.description = newDescription;
  if (newDepartureDate) body.departureDate = newDepartureDate;
  if (newDestination) body.destination = newDestination;
  if (version !== undefined) body.version = version;

  // Keep required fields from current
  if (!body.title && current.title) body.title = current.title;
  if (current.employee) body.employee = current.employee;

  stepNum++;
  const putStart = Date.now();
  const putRes = await client.putWithRetry(`/v2/travelExpense/${expenseId}`, body);
  const success = putRes.status >= 200 && putRes.status < 300;
  stepResults.push({ stepNumber: stepNum, success, statusCode: putRes.status, data: putRes.data, duration: Date.now() - putStart });

  return {
    plan: { summary: `Travel expense ${expenseId} updated`, steps: [] },
    stepResults,
    verified: success,
  };
}
