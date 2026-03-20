import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { StepResult, ExecutionPlan } from "./types.ts";

export async function verifyExecution(
  plan: ExecutionPlan,
  results: StepResult[],
  client: TripletexClient,
  logger: Logger
): Promise<boolean> {
  logger.info("Starting verification");

  // Find the last successful write operation
  const writeSteps = plan.steps.filter((s) =>
    s.method === "POST" || s.method === "PUT" || s.method === "DELETE"
  );

  if (writeSteps.length === 0) {
    logger.info("No write operations to verify");
    return true;
  }

  let allVerified = true;

  for (const step of writeSteps) {
    const stepResult = results.find((r) => r.stepNumber === step.stepNumber);
    if (!stepResult?.success) continue;

    // Try to verify by GET-ing the created/modified resource
    const id = extractIdFromResult(stepResult.data);
    if (id && step.method !== "DELETE") {
      try {
        const verifyResponse = await client.get(`${step.endpoint}/${id}`);
        if (verifyResponse.status === 200) {
          logger.info(`Verified step ${step.stepNumber}: resource ${id} exists`);
        } else {
          logger.warn(`Verification failed for step ${step.stepNumber}: status ${verifyResponse.status}`);
          allVerified = false;
        }
      } catch (err) {
        logger.warn(`Verification error for step ${step.stepNumber}`, { error: String(err) });
        allVerified = false;
      }
    } else if (step.method === "DELETE" && id) {
      try {
        const verifyResponse = await client.get(`${step.endpoint}/${id}`);
        if (verifyResponse.status === 404) {
          logger.info(`Verified step ${step.stepNumber}: resource ${id} deleted`);
        } else {
          logger.warn(`Delete verification: resource ${id} still exists`);
          allVerified = false;
        }
      } catch {
        logger.info(`Verified step ${step.stepNumber}: resource not found (deleted)`);
      }
    }
  }

  logger.info("Verification complete", { allVerified });
  return allVerified;
}

function extractIdFromResult(data: unknown): number | string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (d.value && typeof d.value === "object") {
    const v = d.value as Record<string, unknown>;
    if (v.id !== undefined) return v.id as number;
  }
  if (d.id !== undefined) return d.id as number;
  return undefined;
}
