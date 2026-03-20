import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ExecutionPlan, StepResult, ExecutionStep, Dependency } from "./types.ts";

export async function executeplan(
  plan: ExecutionPlan,
  client: TripletexClient,
  logger: Logger
): Promise<StepResult[]> {
  logger.info("Starting execution", { steps: plan.steps.length });

  const results: StepResult[] = [];
  // Store resolved values from previous steps for dependency resolution
  const resolvedValues: Record<string, unknown> = {};

  for (const step of plan.steps) {
    const start = Date.now();
    logger.info(`Step ${step.stepNumber}: ${step.description}`);

    try {
      // Resolve dependencies in the body
      let body = step.body ? JSON.parse(JSON.stringify(step.body)) : undefined;
      if (body && step.dependsOn) {
        body = resolveDependencies(body, step.dependsOn, resolvedValues, logger);
      }

      const response = await client.request(step.method, step.endpoint, {
        body,
        queryParams: step.queryParams,
      });

      const duration = Date.now() - start;
      const success = response.status >= 200 && response.status < 300;

      // Store result if a resultKey is defined
      if (step.resultKey && success && response.data) {
        const id = extractId(response.data);
        if (id !== undefined) {
          resolvedValues[step.resultKey] = id;
          logger.info(`Stored ${step.resultKey} = ${id}`);
        }
        // Also store the full response data
        resolvedValues[`${step.resultKey}_full`] = response.data;
      }

      results.push({
        stepNumber: step.stepNumber,
        success,
        statusCode: response.status,
        data: response.data,
        duration,
      });

      if (!success) {
        logger.error(`Step ${step.stepNumber} failed`, { status: response.status, data: response.data });
        // Don't stop — continue to try remaining steps unless it's critical
        if (response.status >= 400 && response.status < 500) {
          // Client error — likely a real problem, stop
          logger.error("Stopping execution due to client error");
          break;
        }
      }
    } catch (err) {
      const duration = Date.now() - start;
      logger.error(`Step ${step.stepNumber} threw`, { error: String(err) });
      results.push({
        stepNumber: step.stepNumber,
        success: false,
        statusCode: 0,
        error: String(err),
        duration,
      });
      break;
    }
  }

  logger.info("Execution complete", {
    total: plan.steps.length,
    executed: results.length,
    succeeded: results.filter((r) => r.success).length,
  });

  return results;
}

function resolveDependencies(
  body: Record<string, unknown>,
  deps: Dependency[],
  resolved: Record<string, unknown>,
  logger: Logger
): Record<string, unknown> {
  for (const dep of deps) {
    const value = resolved[dep.dependsOnField] ?? resolved[`step${dep.dependsOnStep}_${dep.dependsOnField}`];
    if (value !== undefined) {
      setNestedValue(body, dep.field, value);
      logger.info(`Resolved dependency: ${dep.field} = ${value}`);
    } else {
      logger.warn(`Could not resolve dependency: ${dep.field} from step ${dep.dependsOnStep}`);
    }
  }
  return body;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function extractId(data: unknown): number | string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  // Tripletex wraps responses in { value: { id: ... } }
  if (d.value && typeof d.value === "object") {
    const v = d.value as Record<string, unknown>;
    if (v.id !== undefined) return v.id as number;
  }
  if (d.id !== undefined) return d.id as number;
  return undefined;
}
