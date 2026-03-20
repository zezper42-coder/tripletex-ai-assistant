// Agent Swarm — LLM dynamic fallback for failed or unsupported tasks

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ParsedTask, ExecutionPlan, StepResult, ExecutionStep } from "./types.ts";
import { ExecutorResult } from "./task-router.ts";
import { executeplan } from "./task-executor.ts";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const TRIPLETEX_API_REFERENCE = `
Tripletex REST API v2 — Key endpoints:

EMPLOYEES:
- GET /v2/employee?firstName=X&lastName=Y — search employees
- POST /v2/employee — create employee. Required: firstName, lastName, userType: "STANDARD". Do NOT include dateOfEmployment.
- PUT /v2/employee/{id} — update employee. Must include "version" from GET. Required: id, firstName, lastName.
- PUT /v2/employee/entitlement/:grantEntitlementsByTemplate?employeeId=N&template=all_administrator — grant admin role
- POST /v2/employment — create employment record. Required: employee.id, startDate.

CUSTOMERS:
- GET /v2/customer?name=X — search customers
- POST /v2/customer — create customer. Required: name. Optional: email, phoneNumber, organizationNumber, invoiceEmail, url.
- PUT /v2/customer/{id} — update customer. Must include "version" from GET.
- Address: use "postalAddress": {"addressLine1":"...", "postalCode":"...", "city":"...", "country":{"name":"Norge"}}. NOT "address".

SUPPLIERS:
- POST /v2/customer — create with isSupplier: true, isCustomer: false. Same fields as customer.
- GET /v2/customer?isSupplier=true&name=X

PRODUCTS:
- GET /v2/product?name=X — search products
- POST /v2/product — create product. Required: name. Optional: number, priceExcludingVatCurrency (number), costExcludingVatCurrency, description, unit (e.g. "stk"), vatType:{id:N}.
- PUT /v2/product/{id} — update product.

INVOICES:
- POST /v2/order — create order first. Required: customer:{id:N}, orderDate (YYYY-MM-DD), deliveryDate (YYYY-MM-DD), orderLines:[{description, count, unitCostCurrency, unitPriceExcludingVatCurrency}].
- PUT /v2/order/{id}/:invoice — convert order to invoice. Body: {invoiceDate, invoiceDueDate}. This is PUT, NOT POST.
- POST /v2/invoice — alternative: create invoice directly with orders:[{id:N}], invoiceDate, invoiceDueDate.

PAYMENTS:
- POST /v2/payment — register payment. Required: amount, paymentDate, invoice:{id:N}.
- GET /v2/ledger/paymentType — list payment types

CREDIT NOTES:
- PUT /v2/invoice/{id}/:createCreditNote — create credit note from invoice

PROJECTS:
- POST /v2/project — Required: name, projectManager:{id:N}, startDate (YYYY-MM-DD). Optional: customer:{id:N}, endDate, number, description.

DEPARTMENTS:
- POST /v2/department — Required: name, departmentNumber (numeric string).

TRAVEL EXPENSES:
- POST /v2/travelExpense — Required: employee:{id:N}, title. Optional: departureDate, returnDate, departure, destination.
- DELETE /v2/travelExpense/{id} — delete travel expense
- GET /v2/travelExpense?employeeId=X

VOUCHERS:
- POST /v2/ledger/voucher — Required: date, description, postings:[{account:{id:N}, amountGross:N}]. Debit=positive, credit=negative.

CONTACTS:
- POST /v2/contact — Required: firstName, lastName, customer:{id:N}. Optional: email, phoneNumber.

ADDRESSES:
- POST /v2/address — create address

ACCOUNTS:
- GET /v2/account?number=X — lookup account by number

VAT:
- GET /v2/ledger/vatType — list VAT types

IMPORTANT CONVENTIONS:
- POST returns { value: { id: ... } }
- GET list returns { fullResultSize: N, values: [...] }
- PUT requires "version" field from the GET response
- References use { id: N } format, e.g. customer: { id: 123 }
- Dates are "YYYY-MM-DD" strings
- Auth: Basic with username "0" and session_token as password
- Customer/supplier address: use "postalAddress" with addressLine1, postalCode, city, country:{name:"..."}. NOT "address".
- Employee does NOT have dateOfEmployment. Use POST /v2/employment for start dates.
- Order REQUIRES orderDate (YYYY-MM-DD)
- Country is always an object: { "name": "Norge" } not a string
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
