/**
 * Recipe-first pipeline: filter noise → parse task with LLM → route to deterministic executor → fallback to agent loop.
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
import { runHeuristics } from "./heuristics.ts";
import { extractActionablePrompt } from "./prompt-filter.ts";

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

    // 1b. Filter noise from prompt
    const cleanedTask = extractActionablePrompt(request.task);
    if (cleanedTask !== request.task) {
      logger.info("Prompt noise filtered", {
        originalLength: request.task.length,
        cleanedLength: cleanedTask.length,
      });
    }

    const fullPrompt = attachmentContext
      ? `${cleanedTask}\n\nAttachment contents:${attachmentContext}`
      : cleanedTask;

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

    // 4. Apply lightweight routing corrections before recipe lookup
    parsed = applyRoutingHints(parsed, fullPrompt, logger);

    // 5. Try recipe-based execution (deterministic executors)
    const taskType = resolveTaskType(parsed.intent, parsed.resourceType);
    logger.info("Resolved task type", { taskType, intent: parsed.intent, resourceType: parsed.resourceType });

    if (taskType !== "unknown") {
      const executor = getExecutor(taskType);
      if (executor) {
        logger.info(`Executing via deterministic recipe: ${taskType}`);
        try {
          const result = await executor(parsed, client, logger);
          const allSuccess = result.stepResults.every((s) => s.success);

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

          logger.warn(`Recipe ${taskType} failed; returning recipe result without agent fallback`, {
            steps: result.stepResults.length,
            errors: result.stepResults.filter((s) => !s.success).map((s) => s.error),
          });
          return {
            status: "failed",
            language: parsed.language,
            parsedTask: parsed,
            executionPlan: result.plan,
            stepResults: result.stepResults,
            verificationPassed: false,
            logs: logger.getEntries(),
            duration: Date.now() - start,
          };
        } catch (execErr) {
          logger.warn(`Recipe executor threw, returning failure without agent fallback`, { error: String(execErr) });
          return {
            status: "failed",
            language: parsed.language,
            parsedTask: parsed,
            executionPlan: null,
            stepResults: [],
            verificationPassed: false,
            logs: logger.getEntries(),
            duration: Date.now() - start,
            error: String(execErr),
          };
        }
      }
    }

    // 6. Fallback: agentic loop for unrecognized or failed recipes
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

function applyRoutingHints(parsed: ParsedTask, prompt: string, logger: Logger): ParsedTask {
  const heuristics = runHeuristics(prompt, logger.child("heuristics"));
  const fields = parsed.fields ?? {};

  let nextIntent = parsed.intent;
  let nextResource = parsed.resourceType;

  const hasInvoiceShape =
    !!(fields.customerName ?? fields.customer_name ?? fields.customer) &&
    Array.isArray((fields.lineItems ?? fields.line_items ?? fields.lines) as unknown);

  const hasPaymentShape =
    !!(fields.invoiceId ?? fields.invoice_id ?? fields.invoiceNumber ?? fields.invoice_number) &&
    !!(fields.amount ?? fields.paymentAmount ?? fields.paymentDate ?? fields.payment_date);

  if (nextIntent === "unknown" && heuristics.likelyAction) {
    nextIntent = heuristics.likelyAction as ParsedTask["intent"];
  }

  if ((nextResource === "unknown" || resolveTaskType(nextIntent, nextResource) === "unknown") && heuristics.likelyResource) {
    nextResource = heuristics.likelyResource as ParsedTask["resourceType"];
  }

  if (nextResource === "order" && nextIntent === "create") {
    nextResource = "invoice";
  }

  if ((nextResource === "unknown" || nextResource === "order") && nextIntent === "create" && hasInvoiceShape) {
    nextResource = "invoice";
  }

  if (nextResource === "unknown" && hasPaymentShape) {
    nextResource = "payment";
    nextIntent = "create";
  }

  if (nextIntent !== parsed.intent || nextResource !== parsed.resourceType) {
    logger.info("Applied routing hints", {
      from: { intent: parsed.intent, resourceType: parsed.resourceType },
      to: { intent: nextIntent, resourceType: nextResource },
      heuristicResource: heuristics.likelyResource,
      heuristicAction: heuristics.likelyAction,
    });
  }

  return {
    ...parsed,
    intent: nextIntent,
    resourceType: nextResource,
  };
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
