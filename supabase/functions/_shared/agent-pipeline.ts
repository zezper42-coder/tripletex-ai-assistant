// Hardened agent pipeline with deterministic routing, heuristics, swarm fallback, solution caching, and structured debug output

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { parseTask } from "./task-parser.ts";
import { planExecution } from "./task-planner.ts";
import { executeplan } from "./task-executor.ts";
import { verifyExecution } from "./task-verifier.ts";
import { processAttachments } from "./attachment-handler.ts";
import { getMockResult } from "./mock-data.ts";
import { runHeuristics } from "./heuristics.ts";
import { resolveTaskType, getExecutor } from "./task-router.ts";
import { runSwarmFallback } from "./agent-swarm.ts";
import { findCachedSolution, saveSolution } from "./solution-cache.ts";
import { SolveRequest, PipelineResult } from "./types.ts";

export async function runPipeline(
  request: SolveRequest,
  apiKey: string
): Promise<PipelineResult> {
  const logger = new Logger("pipeline");
  const start = Date.now();

  // Mock mode
  if (request.mockMode) {
    logger.info("Running in mock mode");
    const mock = getMockResult(request.task);
    mock.logs = logger.getEntries();
    mock.duration = Date.now() - start;
    return mock;
  }

  try {
    // 1. Process attachments if any
    let attachmentContext = "";
    if (request.attachments?.length) {
      const contents = await processAttachments(request.attachments, apiKey, logger);
      attachmentContext = contents
        .filter((c) => c.textContent)
        .map((c) => `\n[Attachment: ${c.filename}]\n${c.textContent}`)
        .join("\n");
    }

    const fullPrompt = attachmentContext
      ? `${request.task}\n\nAttachment contents:${attachmentContext}`
      : request.task;

    // 2. Run heuristics for confidence signals
    logger.info("Step 1: Running heuristics");
    const heuristics = runHeuristics(fullPrompt, logger);

    // 3. Parse task with LLM
    logger.info("Step 2: Parsing task with LLM");
    const parsed = await parseTask(fullPrompt, apiKey, logger);

    // Apply heuristic confidence boost
    if (heuristics.confidenceBoost > 0) {
      parsed.confidence = Math.min(1, parsed.confidence + heuristics.confidenceBoost);
      logger.info(`Confidence adjusted: ${parsed.confidence} (boost: +${heuristics.confidenceBoost})`);
    }

    // Cross-validate heuristics vs LLM
    if (heuristics.likelyResource && heuristics.likelyResource !== parsed.resourceType) {
      const heuristicSignalCount = heuristics.signals.length;
      logger.warn("Heuristic/LLM resource mismatch", {
        heuristic: heuristics.likelyResource,
        llm: parsed.resourceType,
        signals: heuristics.signals,
        heuristicSignalCount,
      });

      if (heuristicSignalCount >= 3 && parsed.confidence < 0.95) {
        logger.info(`Overriding LLM resourceType "${parsed.resourceType}" → heuristic "${heuristics.likelyResource}"`, {
          reason: "Strong heuristic signals outweigh moderate LLM confidence",
        });
        parsed.resourceType = heuristics.likelyResource as any;
      }
      if (heuristics.likelyAction && heuristics.likelyAction !== parsed.intent) {
        parsed.intent = heuristics.likelyAction as any;
      }
    }

    // 4. Check solution cache first
    const cachedPlan = await findCachedSolution(parsed, logger);
    const client = new TripletexClient(
      { baseUrl: request.tripletexApiUrl, sessionToken: request.sessionToken },
      logger.child("tripletex")
    );

    if (cachedPlan) {
      logger.info("Found cached solution, executing");
      // Remap field values from parsed.fields into the cached plan's bodies
      const remappedPlan = remapCachedPlan(cachedPlan, parsed);
      const cachedResults = await executeplan(remappedPlan, client, logger);
      const cachedSuccess = cachedResults.every(r => r.success);

      if (cachedSuccess) {
        logger.info("Cached solution succeeded");
        return {
          status: "completed",
          language: parsed.language,
          parsedTask: parsed,
          executionPlan: remappedPlan,
          stepResults: cachedResults,
          verificationPassed: true,
          logs: logger.getEntries(),
          duration: Date.now() - start,
        };
      }
      logger.warn("Cached solution failed, falling through to executor");
    }

    // 5. Try deterministic executor
    const taskType = resolveTaskType(parsed.intent, parsed.resourceType);
    logger.info(`Task type resolved: ${taskType}`);

    const executor = getExecutor(taskType);

    if (executor) {
      logger.info(`Using dedicated executor for ${taskType}`);

      const executorResult = await executor(parsed, client, logger);
      const allSucceeded = executorResult.stepResults.every((r) => r.success);

      if (allSucceeded) {
        // Save successful plan for future reuse
        saveSolution(parsed, executorResult.plan, logger).catch(() => {});
        return {
          status: "completed",
          language: parsed.language,
          parsedTask: parsed,
          executionPlan: executorResult.plan,
          stepResults: executorResult.stepResults,
          verificationPassed: executorResult.verified,
          logs: logger.getEntries(),
          duration: Date.now() - start,
        };
      }

      // Executor failed — activate Agent Swarm
      logger.warn(`Dedicated executor failed for ${taskType}, activating Agent Swarm`);
      const failError = executorResult.stepResults
        .filter(r => !r.success)
        .map(r => `Step ${r.stepNumber}: HTTP ${r.statusCode} — ${r.error || JSON.stringify(r.data).substring(0, 500)}`)
        .join("\n");

      const swarmResult = await runSwarmFallback(parsed, failError, executorResult.stepResults, client, logger);
      const swarmSuccess = swarmResult.stepResults.every(r => r.success);

      if (swarmSuccess) {
        saveSolution(parsed, swarmResult.plan, logger).catch(() => {});
      }

      return {
        status: swarmSuccess ? "completed" : "failed",
        language: parsed.language,
        parsedTask: parsed,
        executionPlan: swarmResult.plan,
        stepResults: swarmResult.stepResults,
        verificationPassed: swarmResult.verified,
        logs: logger.getEntries(),
        duration: Date.now() - start,
      };
    }

    // 6. Fallback: LLM-planned execution for unsupported task types
    logger.warn(`No dedicated executor for ${taskType}, falling back to LLM planner`);

    const plan = await planExecution(parsed, apiKey, logger);
    const stepResults = await executeplan(plan, client, logger);
    const allSucceeded = stepResults.every((r) => r.success);

    if (allSucceeded) {
      saveSolution(parsed, plan, logger).catch(() => {});
      return {
        status: "completed",
        language: parsed.language,
        parsedTask: parsed,
        executionPlan: plan,
        stepResults,
        verificationPassed: true,
        logs: logger.getEntries(),
        duration: Date.now() - start,
      };
    }

    // LLM planner failed — activate Agent Swarm as last resort
    logger.warn("LLM planner execution failed, activating Agent Swarm as last resort");
    const plannerError = stepResults
      .filter(r => !r.success)
      .map(r => `Step ${r.stepNumber}: HTTP ${r.statusCode} — ${r.error || JSON.stringify(r.data).substring(0, 500)}`)
      .join("\n");

    const swarmResult = await runSwarmFallback(parsed, plannerError, stepResults, client, logger);
    const swarmSuccess = swarmResult.stepResults.every(r => r.success);

    if (swarmSuccess) {
      saveSolution(parsed, swarmResult.plan, logger).catch(() => {});
    }

    return {
      status: swarmSuccess ? "completed" : "failed",
      language: parsed.language,
      parsedTask: parsed,
      executionPlan: swarmResult.plan,
      stepResults: swarmResult.stepResults,
      verificationPassed: swarmResult.verified,
      logs: logger.getEntries(),
      duration: Date.now() - start,
    };
  } catch (err) {
    logger.error("Pipeline failed", { error: String(err) });
    return {
      status: "failed",
      language: "unknown",
      parsedTask: null,
      executionPlan: null,
      stepResults: [],
      verificationPassed: false,
      logs: logger.getEntries(),
      duration: Date.now() - start,
      error: String(err),
    };
  }
}

/**
 * Remap a cached execution plan with fresh field values from the current parsed task.
 * The cached plan has the right structure/endpoints, but field values need updating.
 */
function remapCachedPlan(cachedPlan: ExecutionPlan, parsed: ParsedTask): ExecutionPlan {
  const fields = parsed.fields;
  if (!fields || Object.keys(fields).length === 0) return cachedPlan;

  const remapped = JSON.parse(JSON.stringify(cachedPlan)) as ExecutionPlan;

  for (const step of remapped.steps) {
    if (step.body) {
      step.body = mergeFields(step.body, fields);
    }
  }

  return remapped;
}

/**
 * Recursively merge parsed fields into a cached body template.
 * Matches keys by name — if parsed.fields has "firstName" and the body has "firstName", overwrite it.
 */
function mergeFields(
  body: Record<string, unknown>,
  fields: Record<string, unknown>
): Record<string, unknown> {
  for (const [key, value] of Object.entries(fields)) {
    if (key in body) {
      if (typeof value === "object" && value !== null && typeof body[key] === "object" && body[key] !== null && !Array.isArray(value)) {
        body[key] = mergeFields(body[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        body[key] = value;
      }
    } else {
      // Add new fields from parsed task
      body[key] = value;
    }
  }
  return body;
}
