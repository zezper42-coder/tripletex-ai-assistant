// Agent Swarm — LLM dynamic fallback for failed or unsupported tasks

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ParsedTask, ExecutionPlan, StepResult, ExecutionStep } from "./types.ts";
import { ExecutorResult } from "./task-router.ts";
import { executeplan } from "./task-executor.ts";
import { COMPACT_API_REFERENCE } from "./tripletex-api-reference.ts";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const TRIPLETEX_API_REFERENCE = COMPACT_API_REFERENCE + `

ADDITIONAL CONVENTIONS:
- POST returns { value: { id: ... } }
- GET list returns { fullResultSize: N, values: [...] }
- PUT requires "version" field from the GET response
- References use { id: N } format, e.g. customer: { id: 123 }
- Dates are "YYYY-MM-DD" strings
- Auth: Basic with username "0" and session_token as password
- Country references use { id: N } — Norway = 161
- Employee does NOT have dateOfEmployment. Use POST /employee/employment for start dates.
- Supplier is a SEPARATE endpoint POST /supplier, NOT POST /customer with isSupplier
- Credit notes: PUT /order/{id}/:invoice?invoiceIdIfIsCreditNote={invoiceId}
`;

export async function runSwarmFallback(
  parsed: ParsedTask,
  previousError: string,
  previousStepResults: StepResult[],
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const swarmLogger = logger.child("swarm");
  swarmLogger.info("Agent Swarm activated", {
    intent: parsed.intent,
    resource: parsed.resourceType,
    previousError,
  });

  const gatewayKey = Deno.env.get("LOVABLE_API_KEY");
  if (!gatewayKey) {
    swarmLogger.error("LOVABLE_API_KEY not set");
    return emptyResult("LOVABLE_API_KEY not configured");
  }

  // Build context about what failed
  const failureContext = previousStepResults.length > 0
    ? `Previous attempt made ${previousStepResults.length} API call(s):\n${previousStepResults.map(r =>
        `Step ${r.stepNumber}: ${r.success ? "OK" : "FAILED"} (HTTP ${r.statusCode})${r.error ? ` — ${r.error}` : ""}${r.data ? ` — Response: ${JSON.stringify(r.data).substring(0, 500)}` : ""}`
      ).join("\n")}`
    : "No previous API calls were attempted.";

  const plan = await generateSwarmPlan(parsed, previousError, failureContext, gatewayKey, swarmLogger);
  if (!plan) {
    return emptyResult("Swarm failed to generate a plan");
  }

  swarmLogger.info(`Swarm generated ${plan.steps.length} step(s)`);

  // Execute the swarm-generated plan
  const stepResults = await executeplan(plan, client, swarmLogger);
  const allSucceeded = stepResults.every(r => r.success);

  if (!allSucceeded) {
    // One retry: send errors back to LLM
    swarmLogger.info("First swarm attempt failed, retrying with error feedback");
    const retryError = stepResults
      .filter(r => !r.success)
      .map(r => `Step ${r.stepNumber}: HTTP ${r.statusCode} — ${r.error || JSON.stringify(r.data).substring(0, 500)}`)
      .join("\n");

    const retryPlan = await generateSwarmPlan(parsed, retryError, failureContext, gatewayKey, swarmLogger);
    if (retryPlan) {
      const retryResults = await executeplan(retryPlan, client, swarmLogger);
      const retrySuccess = retryResults.every(r => r.success);
      return {
        plan: retryPlan,
        stepResults: retryResults,
        verified: retrySuccess,
      };
    }
  }

  return {
    plan,
    stepResults,
    verified: allSucceeded,
  };
}

async function generateSwarmPlan(
  parsed: ParsedTask,
  errorContext: string,
  failureDetails: string,
  apiKey: string,
  logger: Logger
): Promise<ExecutionPlan | null> {
  const systemPrompt = `You are a Tripletex API expert agent. Your job is to solve accounting tasks by generating precise API call sequences.

${TRIPLETEX_API_REFERENCE}

RULES:
- Generate the MINIMUM number of API calls needed
- Use exact endpoint paths from the reference above
- Include all required fields in request bodies
- Use { id: N } format for references between steps
- When a step depends on a previous step's created ID, use dependsOn
- Return ONLY valid JSON, no markdown`;

  const userPrompt = `TASK: ${parsed.normalizedPrompt}

INTENT: ${parsed.intent}
RESOURCE: ${parsed.resourceType}
EXTRACTED FIELDS: ${JSON.stringify(parsed.fields)}

ERROR FROM PREVIOUS ATTEMPT:
${errorContext}

${failureDetails}

Generate an execution plan as JSON with this exact structure:
{
  "steps": [
    {
      "stepNumber": 1,
      "description": "what this step does",
      "method": "GET|POST|PUT|DELETE",
      "endpoint": "/v2/...",
      "body": { ... },
      "queryParams": { ... },
      "resultKey": "step1_result",
      "dependsOn": [{ "field": "customer.id", "dependsOnStep": 1, "dependsOnField": "step1_result" }]
    }
  ],
  "summary": "brief description"
}

Return ONLY the JSON object.`;

  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-pro-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        
      }),
    });

    if (!response.ok) {
      logger.error("Swarm LLM call failed", { status: response.status });
      return null;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return null;

    // Parse the JSON plan
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const plan = JSON.parse(cleaned) as ExecutionPlan;

    // Validate structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logger.warn("Swarm returned invalid plan structure");
      return null;
    }

    return plan;
  } catch (err) {
    logger.error("Swarm plan generation failed", { error: String(err) });
    return null;
  }
}

function emptyResult(error: string): ExecutorResult {
  return {
    plan: { steps: [], summary: error },
    stepResults: [],
    verified: false,
  };
}
