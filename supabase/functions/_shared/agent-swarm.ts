// Agent Swarm — GPT-5.4 dynamic fallback for failed or unsupported tasks

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ParsedTask, ExecutionPlan, StepResult, ExecutionStep } from "./types.ts";
import { ExecutorResult } from "./task-router.ts";
import { executeplan } from "./task-executor.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const TRIPLETEX_API_REFERENCE = `
Tripletex REST API v2 — Key endpoints:

EMPLOYEES:
- GET /employee?firstName=X&lastName=Y — search employees
- POST /employee — create employee (required: firstName, lastName)
- PUT /employee/{id} — update employee (send full object with version)
- PUT /employee/{id}/entitlement — set roles (e.g. all_administrator)

CUSTOMERS:
- GET /customer?name=X — search customers
- POST /customer — create customer (required: name)
- PUT /customer/{id} — update customer

SUPPLIERS:
- POST /customer — create with isSupplier: true
- GET /customer?isSupplier=true&name=X

PRODUCTS:
- GET /product?name=X — search products
- POST /product — create product (required: name)

INVOICES:
- POST /invoice — create invoice (required: invoiceDate, invoiceDueDate, orders[])
- POST /order — create order first (required: customer.id, orderDate, deliveryDate, orderLines[])
- PUT /order/{id}/:invoice — create invoice from order (NOT POST, must be PUT with invoiceDate and invoiceDueDate in body)

PAYMENTS:
- POST /payment — register payment (required: amount, date, paymentType.id)
- GET /ledger/paymentType — list payment types

CREDIT NOTES:
- PUT /invoice/{id}/:createCreditNote — create credit note from invoice

PROJECTS:
- POST /project — create project (required: name, projectManager.id, startDate)

DEPARTMENTS:
- POST /department — create department (required: name, departmentNumber)

TRAVEL EXPENSES:
- POST /travelExpense — create travel expense
- DELETE /travelExpense/{id} — delete travel expense
- GET /travelExpense?employeeId=X

VOUCHERS:
- POST /ledger/voucher — create voucher (required: date, description, postings[])
- GET /ledger/voucher?dateFrom=X&dateTo=Y

CONTACTS:
- POST /contact — create contact (required: firstName, lastName, customer.id)

ADDRESSES:
- POST /address — create address

ACCOUNTS:
- GET /ledger/account?number=X — lookup account

IMPORTANT CONVENTIONS:
- POST returns { value: { id: ... } }
- GET list returns { fullResultSize: N, values: [...] }
- PUT requires the "version" field from the GET response
- References use { id: N } format, e.g. customer: { id: 123 }
- Dates are "YYYY-MM-DD" strings
- Auth: Basic with username "0" and session_token as password
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

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    swarmLogger.error("OPENAI_API_KEY not set");
    return emptyResult("OPENAI_API_KEY not configured");
  }

  // Build context about what failed
  const failureContext = previousStepResults.length > 0
    ? `Previous attempt made ${previousStepResults.length} API call(s):\n${previousStepResults.map(r =>
        `Step ${r.stepNumber}: ${r.success ? "OK" : "FAILED"} (HTTP ${r.statusCode})${r.error ? ` — ${r.error}` : ""}${r.data ? ` — Response: ${JSON.stringify(r.data).substring(0, 500)}` : ""}`
      ).join("\n")}`
    : "No previous API calls were attempted.";

  const plan = await generateSwarmPlan(parsed, previousError, failureContext, openaiKey, swarmLogger);
  if (!plan) {
    return emptyResult("Swarm failed to generate a plan");
  }

  swarmLogger.info(`Swarm generated ${plan.steps.length} step(s)`);

  // Execute the swarm-generated plan
  const stepResults = await executeplan(plan, client, swarmLogger);
  const allSucceeded = stepResults.every(r => r.success);

  if (!allSucceeded) {
    // One retry: send errors back to GPT-5.4
    swarmLogger.info("First swarm attempt failed, retrying with error feedback");
    const retryError = stepResults
      .filter(r => !r.success)
      .map(r => `Step ${r.stepNumber}: HTTP ${r.statusCode} — ${r.error || JSON.stringify(r.data).substring(0, 500)}`)
      .join("\n");

    const retryPlan = await generateSwarmPlan(parsed, retryError, failureContext, openaiKey, swarmLogger);
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
  openaiKey: string,
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
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      logger.error("Swarm GPT-5.4 call failed", { status: response.status });
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
