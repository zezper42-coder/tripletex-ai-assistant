import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { parseTask } from "./task-parser.ts";
import { planExecution } from "./task-planner.ts";
import { executeplan } from "./task-executor.ts";
import { verifyExecution } from "./task-verifier.ts";
import { processAttachments } from "./attachment-handler.ts";
import { getMockResult } from "./mock-data.ts";
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

    // 2. Parse task
    logger.info("Step 1: Parsing task");
    const parsed = await parseTask(fullPrompt, apiKey, logger);

    // 3. Plan execution
    logger.info("Step 2: Planning execution");
    const plan = await planExecution(parsed, apiKey, logger);

    // 4. Execute
    logger.info("Step 3: Executing plan");
    const client = new TripletexClient(
      { baseUrl: request.tripletexApiUrl, sessionToken: request.sessionToken },
      logger.child("tripletex")
    );
    const stepResults = await executeplan(plan, client, logger);

    // 5. Verify
    logger.info("Step 4: Verifying results");
    const allSucceeded = stepResults.every((r) => r.success);
    let verified = false;

    if (allSucceeded) {
      verified = await verifyExecution(plan, stepResults, client, logger);
    }

    const status = allSucceeded ? "completed" : "failed";

    return {
      status,
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
