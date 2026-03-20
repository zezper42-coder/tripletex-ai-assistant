/**
 * Agentic pipeline: processes attachments, then hands the task to the ReAct agent loop.
 * The agent autonomously decides which API calls to make.
 */

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { processAttachments } from "./attachment-handler.ts";
import { getMockResult } from "./mock-data.ts";
import { SolveRequest, PipelineResult } from "./types.ts";
import { runAgentLoop } from "./agent-loop.ts";

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

    // 2. Create Tripletex client
    const client = new TripletexClient(
      { baseUrl: request.tripletexApiUrl, sessionToken: request.sessionToken },
      logger.child("tripletex")
    );

    // 3. Run the agentic loop — the LLM decides everything
    logger.info("Starting agentic ReAct loop");
    const agentResult = await runAgentLoop(fullPrompt, client, apiKey, logger);

    logger.info(`Agent completed in ${agentResult.iterations} iterations, ${agentResult.steps.length} API calls`, {
      success: agentResult.success,
      summary: agentResult.summary,
    });

    return {
      status: agentResult.success ? "completed" : "failed",
      language: "unknown", // Agent handles language internally
      parsedTask: null,
      executionPlan: null,
      stepResults: agentResult.steps,
      verificationPassed: agentResult.success,
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
