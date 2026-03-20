import { Logger } from "./logger.ts";
import { ParsedTask, ExecutionPlan, ExecutionStep } from "./types.ts";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Endpoint mapping for Tripletex API v2
const RESOURCE_ENDPOINTS: Record<string, string> = {
  employee: "/v2/employee",
  customer: "/v2/customer",
  product: "/v2/product",
  invoice: "/v2/invoice",
  payment: "/v2/payment",
  creditNote: "/v2/invoice",  // credit notes use invoice endpoint with specific type
  project: "/v2/project",
  travelExpense: "/v2/travelExpense",
  department: "/v2/department",
  order: "/v2/order",
  account: "/v2/ledger/account",
  voucher: "/v2/ledger/voucher",
  contact: "/v2/contact",
  address: "/v2/address",
  activity: "/v2/activity",
};

export async function planExecution(
  parsed: ParsedTask,
  apiKey: string,
  logger: Logger
): Promise<ExecutionPlan> {
  logger.info("Planning execution", { intent: parsed.intent, resource: parsed.resourceType });

  const systemPrompt = `You are an expert Tripletex ERP API planner. Given a parsed task, create an execution plan with specific Tripletex API v2 calls.

Known Tripletex API v2 endpoints:
${Object.entries(RESOURCE_ENDPOINTS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Common patterns:
- POST /v2/employee to create employee
- POST /v2/customer to create customer  
- POST /v2/invoice to create invoice (needs customer ID, invoice date, due date, order lines)
- POST /v2/invoice/{id}/:createCreditNote to create credit note
- POST /v2/payment to register payment
- POST /v2/project to create project (needs name, projectManager with employee ID)
- POST /v2/travelExpense to create travel expense
- POST /v2/department to create department
- PUT endpoints for updates (same path + /{id})
- DELETE endpoints for deletion (same path + /{id})
- GET endpoints for listing/fetching

For invoices, the body structure is:
{ "customer": {"id": <customerId>}, "invoiceDate": "YYYY-MM-DD", "invoiceDueDate": "YYYY-MM-DD", "orders": [...] }

For employees, key fields: firstName, lastName, email, etc.
For customers, key fields: name, email, phoneNumber, etc.

Important: some resources require looking up existing IDs first (e.g., creating an invoice needs a customer ID).

Return the plan using the create_plan function.`;

  const tools = [
    {
      type: "function",
      function: {
        name: "create_plan",
        description: "Create a step-by-step Tripletex API execution plan",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Brief summary of what the plan does" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  stepNumber: { type: "number" },
                  description: { type: "string" },
                  method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
                  endpoint: { type: "string", description: "Tripletex API path e.g. /v2/customer" },
                  body: { type: "object", description: "Request body for POST/PUT", additionalProperties: true },
                  queryParams: { type: "object", description: "Query parameters", additionalProperties: { type: "string" } },
                  resultKey: { type: "string", description: "Key to store result ID for use in later steps, e.g. 'customerId'" },
                  dependsOn: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        field: { type: "string" },
                        dependsOnStep: { type: "number" },
                        dependsOnField: { type: "string" },
                      },
                      required: ["field", "dependsOnStep", "dependsOnField"],
                    },
                  },
                },
                required: ["stepNumber", "description", "method", "endpoint"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "steps"],
          additionalProperties: false,
        },
      },
    },
  ];

  const gatewayKey = Deno.env.get("LOVABLE_API_KEY");
  if (!gatewayKey) throw new Error("LOVABLE_API_KEY is not configured");

  const response = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gatewayKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-pro-preview",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Parsed task:\n${JSON.stringify(parsed, null, 2)}\n\nCreate the execution plan.`,
        },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "create_plan" } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error("LLM planning failed", { status: response.status, body: errText });
    throw new Error(`LLM planning failed: ${response.status}`);
  }

  const result = await response.json();
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall) {
    logger.error("No tool call in planner response", { result });
    throw new Error("LLM planner did not return structured output");
  }

  const plan: ExecutionPlan = JSON.parse(toolCall.function.arguments);
  logger.info("Plan created", { stepCount: plan.steps.length, summary: plan.summary });

  return plan;
}
