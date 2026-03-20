/**
 * Agentic ReAct loop: LLM decides which Tripletex API calls to make,
 * observes results, and iterates until the task is complete.
 */

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { StepResult } from "./types.ts";
import { SCHEMA_REFERENCE, COMPACT_API_REFERENCE } from "./tripletex-api-reference.ts";

const MAX_ITERATIONS = 15;
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.1-pro-preview";

// Tool definitions for the LLM
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "api_call",
      description: "Execute an HTTP request against the Tripletex API. The endpoint must start with /v2/. For GET/DELETE, body is not used. For query parameters on action endpoints like :payment or :invoice, use queryParams.",
      parameters: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description: "Brief explanation of why this API call is needed",
          },
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "DELETE"],
            description: "HTTP method",
          },
          endpoint: {
            type: "string",
            description: "API endpoint path starting with /v2/, e.g. /v2/customer, /v2/employee/123",
          },
          body: {
            type: "object",
            description: "Request body for POST/PUT requests. Must follow the Tripletex schema exactly.",
          },
          queryParams: {
            type: "object",
            description: "Query parameters as key-value string pairs. Used for GET filters, pagination, and action endpoints like :payment.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["reasoning", "method", "endpoint"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "done",
      description: "Signal that the task is complete. Call this when all required API operations have been successfully executed.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Brief summary of what was accomplished",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a Tripletex accounting API agent. You receive a natural-language accounting task and must execute it by making the correct API calls.

## How you work
1. Read the task carefully. Identify what needs to be created/updated/deleted.
2. Plan the minimal sequence of API calls needed.
3. Execute them one at a time using the api_call tool.
4. Observe each response. Use returned IDs in subsequent calls.
5. When all operations are done, call the done tool.

## Critical rules
- ALWAYS use the exact field names from the schema below. Do NOT guess field names.
- References to other objects use {id: N} format, e.g. customer: {id: 123}
- Norway country ID = 161
- Use postalAddress (NOT address) for customers and suppliers
- Employment dates go on /v2/employee/employment, NOT on the employee object
- Invoice payment uses PUT /v2/invoice/{id}/:payment with QUERY PARAMS (paymentDate, paymentTypeId, paidAmount), NOT a body
- Credit notes: use PUT /v2/invoice/{id}/:createCreditNote with query param date=YYYY-MM-DD
- Creating invoice from order: PUT /v2/order/{id}/:invoice with query param invoiceDate=YYYY-MM-DD
- For GET requests, always add fields=* to queryParams to get all fields
- When searching, use relevant query params (e.g. name, firstName, lastName)
- Each fresh account starts empty — create prerequisites (customer, employee, etc.) before referencing them
- Reuse IDs from creation responses — do NOT make extra GET calls to find what you just created
- Minimize total API calls. Plan ahead.
- When the task mentions making someone an administrator/admin, you need to:
  1. Create/update the employee with userType: "EXTENDED"
  2. Then call PUT /v2/employee/{id}/entitlement/:grantEntitlementsByTemplate with queryParams templateType=all_administrator
- For departments, if the task mentions enabling modules, call POST /v2/company/salesmodules with body {salesModule: {id: MODULE_ID}} after creating the department

## Multi-language support
Tasks may be in Norwegian (bokmål/nynorsk), English, Spanish, Portuguese, German, or French. Parse the intent regardless of language.

## API Reference
${COMPACT_API_REFERENCE}

## Detailed Schema
${SCHEMA_REFERENCE}
`;

export interface AgentLoopResult {
  steps: StepResult[];
  summary: string;
  iterations: number;
  success: boolean;
}

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export async function runAgentLoop(
  task: string,
  client: TripletexClient,
  apiKey: string,
  logger: Logger
): Promise<AgentLoopResult> {
  const steps: StepResult[] = [];
  let stepNumber = 0;

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    logger.info(`Agent iteration ${iteration + 1}`);

    // Call LLM with tools
    const llmResponse = await callLLM(messages, apiKey, logger);

    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
      // No tool calls — LLM responded with text (shouldn't happen with tool_choice, but handle it)
      logger.info("Agent responded with text (no tool calls), treating as done");
      return {
        steps,
        summary: llmResponse.content || "Task completed",
        iterations: iteration + 1,
        success: steps.length === 0 || steps.every(s => s.success),
      };
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: llmResponse.content || null,
      tool_calls: llmResponse.tool_calls,
    });

    // Process each tool call
    for (const toolCall of llmResponse.tool_calls) {
      const fnName = toolCall.function.name;
      let args: Record<string, unknown>;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        logger.error(`Failed to parse tool call arguments: ${toolCall.function.arguments}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Invalid JSON in tool arguments" }),
        });
        continue;
      }

      if (fnName === "done") {
        logger.info(`Agent done: ${(args as any).summary}`);
        return {
          steps,
          summary: (args as any).summary || "Task completed",
          iterations: iteration + 1,
          success: steps.length === 0 || steps.every(s => s.success),
        };
      }

      if (fnName === "api_call") {
        stepNumber++;
        const method = args.method as string;
        const endpoint = args.endpoint as string;
        const body = args.body as Record<string, unknown> | undefined;
        const queryParams = args.queryParams as Record<string, string> | undefined;
        const reasoning = args.reasoning as string;

        logger.info(`Step ${stepNumber}: ${method} ${endpoint}`, { reasoning });

        const start = Date.now();
        try {
          const result = await client.request(method, endpoint, {
            body,
            queryParams,
          });

          const stepResult: StepResult = {
            stepNumber,
            success: result.status >= 200 && result.status < 300,
            statusCode: result.status,
            data: result.data,
            duration: Date.now() - start,
          };

          if (!stepResult.success) {
            stepResult.error = typeof result.data === "object" && result.data !== null
              ? JSON.stringify(result.data).substring(0, 1000)
              : String(result.data);
          }

          steps.push(stepResult);

          // Feed observation back to LLM
          const observation = {
            status: result.status,
            success: stepResult.success,
            data: truncateData(result.data, 2000),
          };

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(observation),
          });

          logger.info(`Step ${stepNumber} result: ${result.status} ${stepResult.success ? "OK" : "FAILED"}`);
        } catch (err) {
          const stepResult: StepResult = {
            stepNumber,
            success: false,
            statusCode: 0,
            error: String(err),
            duration: Date.now() - start,
          };
          steps.push(stepResult);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: String(err), status: 0 }),
          });

          logger.error(`Step ${stepNumber} threw: ${err}`);
        }
      }
    }
  }

  logger.warn(`Agent hit max iterations (${MAX_ITERATIONS})`);
  return {
    steps,
    summary: "Hit maximum iteration limit",
    iterations: MAX_ITERATIONS,
    success: steps.every(s => s.success),
  };
}

async function callLLM(
  messages: Message[],
  apiKey: string,
  logger: Logger
): Promise<{ content?: string; tool_calls?: ToolCall[] }> {
  const start = Date.now();

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error(`LLM call failed: ${response.status}`, { error: errText });
    throw new Error(`LLM API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0]?.message;
  
  logger.info(`LLM responded in ${Date.now() - start}ms`, {
    hasContent: !!choice?.content,
    toolCalls: choice?.tool_calls?.length || 0,
  });

  return {
    content: choice?.content,
    tool_calls: choice?.tool_calls,
  };
}

/**
 * Truncate large API response data to keep context window manageable.
 */
function truncateData(data: unknown, maxLen: number): unknown {
  if (data === null || data === undefined) return data;
  const json = JSON.stringify(data);
  if (json.length <= maxLen) return data;

  // For list responses, keep first few items
  if (typeof data === "object" && data !== null && "values" in (data as any)) {
    const obj = data as Record<string, unknown>;
    const values = obj.values as unknown[];
    if (Array.isArray(values) && values.length > 3) {
      return {
        ...obj,
        values: values.slice(0, 3),
        _truncated: `Showing 3 of ${values.length} items`,
      };
    }
  }

  // For single responses, try to keep value
  if (typeof data === "object" && data !== null && "value" in (data as any)) {
    return data; // Single objects are usually small enough
  }

  // Last resort: stringify and cut
  return JSON.parse(json.substring(0, maxLen));
}
