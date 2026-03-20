// Hardened agent pipeline with deterministic routing, heuristics, and structured debug output

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
      logger.warn("Heuristic/LLM resource mismatch", {
        heuristic: heuristics.likelyResource,
        llm: parsed.resourceType,
        signals: heuristics.signals,
      });
      // Trust LLM but log the mismatch
    }

    // 4. Try deterministic executor first
    const taskType = resolveTaskType(parsed.intent, parsed.resourceType);
    logger.info(`Task type resolved: ${taskType}`);

    const executor = getExecutor(taskType);

    if (executor) {
      // Deterministic path — use dedicated executor
      logger.info(`Using dedicated executor for ${taskType}`);
      const client = new TripletexClient(
        { baseUrl: request.tripletexApiUrl, sessionToken: request.sessionToken },
        logger.child("tripletex")
      );

      const executorResult = await executor(parsed, client, logger);

      const allSucceeded = executorResult.stepResults.every((r) => r.success);

      return {
        status: allSucceeded ? "completed" : "failed",
        language: parsed.language,
        parsedTask: parsed,
        executionPlan: executorResult.plan,
        stepResults: executorResult.stepResults,
        verificationPassed: executorResult.verified,
        logs: logger.getEntries(),
        duration: Date.now() - start,
      };
    }

    // 5. Fallback: LLM-planned execution for unsupported task types
    logger.warn(`No dedicated executor for ${taskType}, falling back to LLM planner`);

    const plan = await planExecution(parsed, apiKey, logger);

    const client = new TripletexClient(
      { baseUrl: request.tripletexApiUrl, sessionToken: request.sessionToken },
      logger.child("tripletex")
    );
    const stepResults = await executeplan(plan, client, logger);

    const allSucceeded = stepResults.every((r) => r.success);
    let verified = false;
    if (allSucceeded) {
      verified = await verifyExecution(plan, stepResults, client, logger);
    }

    return {
      status: allSucceeded ? "completed" : "failed",
      language: parsed.language,
      parsedTask: parsed,
      executionPlan: plan,
      stepResults,
      verificationPassed: verified,
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
