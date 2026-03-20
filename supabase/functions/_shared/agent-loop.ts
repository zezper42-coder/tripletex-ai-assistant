/**
 * Agentic ReAct loop: LLM decides which Tripletex API calls to make,
 * observes results, and iterates until the task is complete.
 */

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { StepResult } from "./types.ts";
import { SCHEMA_REFERENCE, COMPACT_API_REFERENCE } from "./tripletex-api-reference.ts";

const MAX_ITERATIONS = 20;
const TIMEOUT_MS = 240_000; // 4 min safety margin (competition limit is 5 min)
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

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

const SYSTEM_PROMPT = `You are a Tripletex accounting API execution agent. You receive an accounting task and MUST complete it using ONLY the API endpoints listed below.

## CRITICAL EFFICIENCY RULES — READ FIRST
1. Every 4xx error REDUCES your competition score. Plan BEFORE calling.
2. NEVER try to fetch swagger.json, openapi.json, or discover/explore unknown endpoints.
3. ONLY use endpoints listed in the API Reference below. If an endpoint is not listed, DO NOT try it.
4. NEVER make more than 2 attempts at the same endpoint with different bodies — if it fails twice, try a different approach or call done.
5. Reuse IDs from creation responses — do NOT make extra GET calls to find what you just created.
6. Minimize total API calls. The fewer calls with zero errors = higher score.
7. Total time limit is 4 minutes. Work fast and decisively.
8. Do NOT explore or test endpoints. You are an EXECUTOR, not an explorer.
9. If you don't know how to do something with the listed endpoints, call done and explain — do NOT guess random endpoints.

## How you work
1. Read the task carefully. Identify what needs to be created/updated/deleted.
2. Plan the COMPLETE sequence of API calls in your head BEFORE making any.
3. Execute them one at a time using the api_call tool.
4. Observe each response. Use returned IDs in subsequent calls.
5. When all operations are done, call the done tool.

## Key patterns
- **Create employee**: POST /v2/employee (firstName, lastName, email, dateOfBirth). If admin role needed: also POST with userType "EXTENDED", then PUT /v2/employee/{id}/entitlement/:grantEntitlementsByTemplate?templateType=all_administrator
- **Create customer**: POST /v2/customer (name, email, postalAddress, NOT address)
- **Create product**: POST /v2/product (name, priceExcludingVatCurrency, vatType:{id})
- **Create invoice**: POST /v2/order (customer:{id}, orderDate, orderLines) → PUT /v2/order/{id}/:invoice?invoiceDate=YYYY-MM-DD
- **Register payment**: PUT /v2/invoice/{id}/:payment?paymentDate=X&paymentTypeId=Y&paidAmount=Z (QUERY PARAMS, not body)
- **Credit note**: PUT /v2/invoice/{id}/:createCreditNote?date=YYYY-MM-DD
- **Travel expense**: POST /v2/travelExpense (employee:{id}, title, travelDetails)
- **Delete resource**: GET to find it first, then DELETE /v2/{resource}/{id}
- **Create department**: POST /v2/department (name)
- **Create project**: POST /v2/project (name, projectManager:{id})
- **Create supplier**: POST /v2/supplier (name, postalAddress, NOT address)
- **Create contact**: POST /v2/contact (firstName, lastName, customer:{id})
- **Employee employment**: POST /v2/employee/employment (employee:{id}, startDate) — dateOfBirth MUST be set on the employee first
- **Salary transaction**: POST /v2/salary/transaction (employee:{id}, year, month, payslips array — needs employment first)
- **Enable modules**: POST /v2/company/salesmodules with {salesModule:{id:MODULE_ID}}

## Multi-language support
Tasks may be in Norwegian (bokmål/nynorsk), English, Spanish, Portuguese, German, or French. Parse the intent regardless of language.

## Common required fields
- Norway country ID = 161
- For GET requests, add fields=* to queryParams
- References use {id: N} format
- Dates are YYYY-MM-DD format
- Each fresh account starts empty — create prerequisites first
- Employee dateOfBirth is REQUIRED for creating employment records

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
  const loopStart = Date.now();
  const endpointFailures = new Map<string, number>();

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Timeout check
    if (Date.now() - loopStart > TIMEOUT_MS) {
      logger.warn(`Agent timeout after ${iteration} iterations`);
      return {
        steps,
        summary: "Timed out — returning partial results",
        iterations: iteration,
        success: steps.some(s => s.success),
      };
    }

    logger.info(`Agent iteration ${iteration + 1}`);

    // Call LLM with tools
    const llmResponse = await callLLM(messages, apiKey, logger);

    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
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

        // Block exploration attempts
        if (endpoint.includes("swagger") || endpoint.includes("openapi")) {
          logger.warn(`Blocked exploration attempt: ${endpoint}`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: "Endpoint discovery is not allowed. Use only the endpoints from the API reference." }),
          });
          continue;
        }

        // Check endpoint failure count — skip if already failed 2+ times
        const endpointKey = `${method} ${endpoint}`;
        const failCount = endpointFailures.get(endpointKey) || 0;
        if (failCount >= 2) {
          logger.warn(`Skipping ${endpointKey} — already failed ${failCount} times`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: `This endpoint has already failed ${failCount} times. Try a different approach or call done.`,
              status: 0,
            }),
          });
          continue;
        }

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
            // Track failures
            endpointFailures.set(endpointKey, failCount + 1);
          }

          steps.push(stepResult);

          // Feed observation back to LLM
          const observation = {
            status: result.status,
            success: stepResult.success,
            data: truncateData(result.data, 1500),
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
          endpointFailures.set(endpointKey, failCount + 1);

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
    if (Array.isArray(values) && values.length > 2) {
      return {
        ...obj,
        values: values.slice(0, 2),
        _truncated: `Showing 2 of ${values.length} items`,
      };
    }
  }

  // For single responses, try to keep value
  if (typeof data === "object" && data !== null && "value" in (data as any)) {
    return data;
  }

  // Last resort: stringify and cut
  try {
    return JSON.parse(json.substring(0, maxLen));
  } catch {
    return { _truncated: true, preview: json.substring(0, 500) };
  }
}
