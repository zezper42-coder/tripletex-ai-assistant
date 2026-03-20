import { Logger } from "./logger.ts";
import { ParsedTask, ExecutionPlan, ExecutionStep } from "./types.ts";
import { COMPACT_API_REFERENCE } from "./tripletex-api-reference.ts";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function planExecution(
  parsed: ParsedTask,
  apiKey: string,
  logger: Logger
): Promise<ExecutionPlan> {
  logger.info("Planning execution", { intent: parsed.intent, resource: parsed.resourceType });

  const systemPrompt = `You are an expert Tripletex ERP API planner. Given a parsed task, create an execution plan with specific API calls.

${COMPACT_API_REFERENCE}

CRITICAL RULES:
1. All entity references use {id: N} format, e.g. customer: {id: 123}
2. Payment registration uses QUERY PARAMS on PUT /invoice/{id}/:payment, NOT a request body
3. Invoice creation: POST /order then PUT /order/{id}/:invoice?invoiceDate=YYYY-MM-DD
4. Use postalAddress (NOT address) for customers and suppliers
5. Employment dates go via POST /employee/employment, NOT on the employee object
6. orderDate is REQUIRED when creating orders
7. projectManager is REQUIRED when creating projects (must be an employee ID)
8. Always include orderLines when creating orders
9. For updates: GET the resource first to get the current version number, then PUT with version
10. For deletes: just DELETE /resource/{id}

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
