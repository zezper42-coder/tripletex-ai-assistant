/**
 * Recipe-first pipeline: parse task with LLM → route to deterministic executor → fallback to agent loop.
 * Attachment data is merged into parsed fields before execution.
 */

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { processAttachments } from "./attachment-handler.ts";
import { getMockResult } from "./mock-data.ts";
import { SolveRequest, PipelineResult, ParsedTask } from "./types.ts";
import { parseTask } from "./task-parser.ts";
import { resolveTaskType, getExecutor } from "./task-router.ts";
import { runAgentLoop } from "./agent-loop.ts";

export async function runPipeline(
  request: SolveRequest,
  apiKey: string
): Promise<PipelineResult> {
  const logger = new Logger("pipeline");
  const start = Date.now();

  if (request.mockMode) {
    logger.info("Running in mock mode");
    const mock = getMockResult(request.task);
    mock.logs = logger.getEntries();
    mock.duration = Date.now() - start;
    return mock;
  }

  try {
    // 1. Process attachments
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

    // 2. Create Tripletex client
    const client = new TripletexClient(
      { baseUrl: request.tripletexApiUrl, sessionToken: request.sessionToken },
      logger.child("tripletex")
    );

    // 3. Parse task with LLM (single LLM call to extract structured data)
    logger.info("Parsing task with LLM");
    let parsed: ParsedTask;
    try {
      parsed = await parseTask(fullPrompt, apiKey, logger);
      logger.info("Task parsed successfully", {
        intent: parsed.intent,
        resourceType: parsed.resourceType,
        confidence: parsed.confidence,
      });
    } catch (parseErr) {
      logger.warn("LLM parsing failed, falling back to agent loop", { error: String(parseErr) });
      return await runAgentFallback(fullPrompt, client, apiKey, logger, start);
    }

    // 4. Try recipe-based execution (deterministic executors)
    const taskType = resolveTaskType(parsed.intent, parsed.resourceType);
    logger.info("Resolved task type", { taskType, intent: parsed.intent, resourceType: parsed.resourceType });

    if (taskType !== "unknown") {
      const executor = getExecutor(taskType);
      if (executor) {
        logger.info(`Executing via deterministic recipe: ${taskType}`);
        try {
          const result = await executor(parsed, client, logger);
          const allSuccess = result.stepResults.every((s) => s.success);
          const anyWrite = result.stepResults.some(
            (s) => s.success && s.statusCode >= 200 && s.statusCode < 300 && s.statusCode !== 204
          );

          if (result.verified || allSuccess) {
            logger.info(`Recipe execution succeeded: ${taskType}`, {
              steps: result.stepResults.length,
              allSuccess,
            });
            return {
              status: "completed",
              language: parsed.language,
              parsedTask: parsed,
              executionPlan: result.plan,
              stepResults: result.stepResults,
              verificationPassed: result.verified,
              logs: logger.getEntries(),
              duration: Date.now() - start,
            };
          }

          // Recipe failed — fall through to agent loop with context
          logger.warn(`Recipe ${taskType} failed, falling back to agent loop`, {
            steps: result.stepResults.length,
            errors: result.stepResults.filter((s) => !s.success).map((s) => s.error),
          });
        } catch (execErr) {
          logger.warn(`Recipe executor threw, falling back to agent loop`, { error: String(execErr) });
        }
      }
    }

    // 5. Fallback: agentic loop for unrecognized or failed recipes
    logger.info("Falling back to agentic ReAct loop");
    return await runAgentFallback(fullPrompt, client, apiKey, logger, start);
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

async function runAgentFallback(
  fullPrompt: string,
  client: TripletexClient,
  apiKey: string,
  logger: Logger,
  start: number,
): Promise<PipelineResult> {
  const agentResult = await runAgentLoop(fullPrompt, client, apiKey, logger);
  logger.info(`Agent completed in ${agentResult.iterations} iterations, ${agentResult.steps.length} API calls`, {
    success: agentResult.success,
    summary: agentResult.summary,
  });
  return {
    status: agentResult.success ? "completed" : "failed",
    language: "unknown",
    parsedTask: null,
    executionPlan: null,
    stepResults: agentResult.steps,
    verificationPassed: agentResult.success,
    logs: logger.getEntries(),
    duration: Date.now() - start,
  };
}
