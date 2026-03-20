/**
 * Agentic ReAct loop: LLM decides which Tripletex API calls to make,
 * observes results, and iterates until the task is complete.
 */

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { StepResult } from "./types.ts";
import { SCHEMA_REFERENCE, COMPACT_API_REFERENCE } from "./tripletex-api-reference.ts";
import { VatTypeLookup } from "./vat-lookup.ts";

const MAX_ITERATIONS = 20;
const TIMEOUT_MS = 240_000; // 4 min safety margin (competition limit is 5 min)
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

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
      name: "resolve_vat_type",
      description: "Resolve a VAT type ID safely. Prefer this over manually calling /v2/ledger/vatType when you need the VAT type for 25%, 15%, 12%, 0%, or a named VAT type.",
      parameters: {
        type: "object",
        properties: {
          rate: {
            type: "number",
            description: "VAT rate percent, e.g. 25, 15, 12, 0",
          },
          code: {
            type: "number",
            description: "VAT code/number if known",
          },
          name: {
            type: "string",
            description: "Partial VAT type name if known",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "done",
      description: "Signal that the task is complete. Call this only after the required create/update/delete operations have been successfully executed.",
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

const SYSTEM_PROMPT = `You are a Tripletex accounting API execution agent. You receive an accounting task and MUST complete it using ONLY the API endpoints and tools listed below.

## CRITICAL EFFICIENCY RULES — READ FIRST
1. Every 4xx error REDUCES your competition score. Plan BEFORE calling.
2. NEVER try to fetch swagger.json, openapi.json, or discover/explore unknown endpoints.
3. ONLY use endpoints listed in the API Reference below. If an endpoint is not listed, DO NOT try it.
4. NEVER make more than 2 attempts at the same endpoint with different bodies — if it fails twice, try a different approach.
5. Reuse IDs from creation responses — do NOT make extra GET calls to find what you just created.
6. Minimize total API calls. The fewer calls with zero errors = higher score.
7. Total time limit is 4 minutes. Work fast and decisively.
8. Do NOT explore or test endpoints. You are an EXECUTOR, not an explorer.
9. Use the resolve_vat_type tool instead of manually experimenting with /v2/ledger/vatType.
10. Fresh accounts start empty. If a needed customer/product/employee does not exist, CREATE it.
11. Do not call done before you have actually changed data unless the task is truly impossible.

## How you work
1. Read the task carefully. Identify what must be created/updated/deleted.
2. Plan the COMPLETE sequence of API calls before making any.
3. Use GET only when you must find an existing object.
4. If a search returns no results, create the prerequisite resource.
5. Execute one step at a time using the tools.
6. When all required writes are done, call done.

## Key patterns
- **Create employee**: POST /v2/employee with firstName, lastName, email, dateOfBirth if available.
- **Grant admin role**: create/update employee with userType "EXTENDED", then PUT /v2/employee/{id}/entitlement/:grantEntitlementsByTemplate?templateType=all_administrator.
- **Create customer**: POST /v2/customer using postalAddress, NOT address.
- **Create product**: POST /v2/product. If VAT is needed, use resolve_vat_type first.
- **Create invoice**: usually POST /v2/order, then PUT /v2/order/{id}/:invoice?invoiceDate=YYYY-MM-DD.
- **Register payment**: PUT /v2/invoice/{id}/:payment with QUERY PARAMS, not body.
- **Credit note**: PUT /v2/invoice/{id}/:createCreditNote?date=YYYY-MM-DD.
- **Travel expense**: create employee first if needed, then POST /v2/travelExpense.
- **Delete resource**: GET to identify the exact object, then DELETE /v2/{resource}/{id}.
- **Employee employment**: POST /v2/employee/employment. The employee must already have dateOfBirth.
- **Enable modules**: POST /v2/company/salesmodules with {salesModule:{id:MODULE_ID}}.

## Search behavior
- For GET requests, add fields=*.
- If a GET list response has values: [], that means nothing exists yet.
- In that case, create the missing prerequisite instead of repeating the same GET.

## Multi-language support
Tasks may be in Norwegian (bokmål/nynorsk), English, Spanish, Portuguese, German, or French. Parse the intent regardless of language.

## Common required fields
- Norway country ID = 161
- References use {id: N} format
- Dates are YYYY-MM-DD format
- Employee dateOfBirth is REQUIRED before creating employment records

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
  let successfulWriteCount = 0;
  const loopStart = Date.now();
  const endpointFailures = new Map<string, number>();
  const vatLookup = new VatTypeLookup(client, logger);

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (Date.now() - loopStart > TIMEOUT_MS) {
      logger.warn(`Agent timeout after ${iteration} iterations`);
      return {
        steps,
        summary: "Timed out — returning partial results",
        iterations: iteration,
        success: successfulWriteCount > 0,
      };
    }

    logger.info(`Agent iteration ${iteration + 1}`);
    const llmResponse = await callLLM(messages, apiKey, logger);

    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
      logger.info("Agent responded with text (no tool calls), treating as done");
      return {
        steps,
        summary: llmResponse.content || "Task completed",
        iterations: iteration + 1,
        success: successfulWriteCount > 0 && steps.every((s) => s.success),
      };
    }

    messages.push({
      role: "assistant",
      content: llmResponse.content || null,
      tool_calls: llmResponse.tool_calls,
    });

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
        if (successfulWriteCount === 0) {
          logger.warn("Rejected done call before any successful write");
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: "Task is likely incomplete: no successful create/update/delete has happened yet. If searches returned empty results, create the missing resources and continue.",
            }),
          });
          continue;
        }

        logger.info(`Agent done: ${(args as any).summary}`);
        return {
          steps,
          summary: (args as any).summary || "Task completed",
          iterations: iteration + 1,
          success: successfulWriteCount > 0 && steps.every((s) => s.success),
        };
      }

      if (fnName === "resolve_vat_type") {
        const rate = typeof args.rate === "number" ? args.rate : undefined;
        const code = typeof args.code === "number" ? args.code : undefined;
        const name = typeof args.name === "string" ? args.name : undefined;
        const vatType = await vatLookup.resolve({ rate, code, name });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            found: !!vatType,
            vatType,
          }),
        });
        continue;
      }

      if (fnName !== "api_call") {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Unknown tool: ${fnName}` }),
        });
        continue;
      }

      stepNumber++;
      const method = args.method as string;
      const endpoint = args.endpoint as string;
      const body = args.body as Record<string, unknown> | undefined;
      const queryParams = normalizeQueryParams(method, endpoint, args.queryParams as Record<string, string> | undefined, logger);
      const reasoning = args.reasoning as string;

      if (endpoint.includes("swagger") || endpoint.includes("openapi")) {
        logger.warn(`Blocked exploration attempt: ${endpoint}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Endpoint discovery is not allowed. Use only the endpoints from the API reference." }),
        });
        continue;
      }

      const endpointKey = `${method} ${endpoint}`;
      const failCount = endpointFailures.get(endpointKey) || 0;
      if (failCount >= 2) {
        logger.warn(`Skipping ${endpointKey} — already failed ${failCount} times`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: `This endpoint has already failed ${failCount} times. Try a different approach instead of repeating it.`,
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
          retries: 0,
        });

        const success = result.status >= 200 && result.status < 300;
        const stepResult: StepResult = {
          stepNumber,
          success,
          statusCode: result.status,
          data: result.data,
          duration: Date.now() - start,
        };

        if (!success) {
          stepResult.error = typeof result.data === "object" && result.data !== null
            ? JSON.stringify(result.data).substring(0, 1000)
            : String(result.data);
          endpointFailures.set(endpointKey, failCount + 1);
        } else if (method !== "GET") {
          successfulWriteCount++;
        }

        steps.push(stepResult);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(buildObservation(result.status, result.data, success)),
        });

        logger.info(`Step ${stepNumber} result: ${result.status} ${success ? "OK" : "FAILED"}`);
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

  logger.warn(`Agent hit max iterations (${MAX_ITERATIONS})`);
  return {
    steps,
    summary: "Hit maximum iteration limit",
    iterations: MAX_ITERATIONS,
    success: successfulWriteCount > 0 && steps.every((s) => s.success),
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

function normalizeQueryParams(
  method: string,
  endpoint: string,
  queryParams: Record<string, string> | undefined,
  logger: Logger
): Record<string, string> | undefined {
  if (method !== "GET") return queryParams;

  const normalized = { ...(queryParams || {}) };

  if (!normalized.fields) {
    normalized.fields = "*";
  }

  if (endpoint === "/v2/ledger/vatType" && normalized.fields !== "*") {
    logger.warn("Overriding vatType fields filter to fields=*", { originalFields: normalized.fields });
    normalized.fields = "*";
  }

  return normalized;
}

function buildObservation(status: number, data: unknown, success: boolean) {
  const observation: Record<string, unknown> = {
    status,
    success,
    data: truncateData(data, 1500),
  };

  if (typeof data === "object" && data !== null && "values" in (data as Record<string, unknown>)) {
    const values = (data as Record<string, unknown>).values;
    if (Array.isArray(values)) {
      observation.resultCount = values.length;
      observation.emptyResult = values.length === 0;
    }
  }

  return observation;
}

function truncateData(data: unknown, maxLen: number): unknown {
  if (data === null || data === undefined) return data;
  const json = JSON.stringify(data);
  if (json.length <= maxLen) return data;

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

  if (typeof data === "object" && data !== null && "value" in (data as any)) {
    return data;
  }

  try {
    return JSON.parse(json.substring(0, maxLen));
  } catch {
    return { _truncated: true, preview: json.substring(0, 500) };
  }
}
