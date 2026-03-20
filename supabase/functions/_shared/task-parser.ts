import { Logger } from "./logger.ts";
import { ParsedTask, Language, Intent, ResourceType, Dependency } from "./types.ts";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function parseTask(
  taskPrompt: string,
  apiKey: string,
  logger: Logger
): Promise<ParsedTask> {
  logger.info("Parsing task with LLM", { promptLength: taskPrompt.length });

  const systemPrompt = `You are an expert accounting task parser for Tripletex ERP. 
Given a task description (possibly in Norwegian, English, Spanish, Portuguese, Nynorsk, German, or French), extract structured information.

You must call the parse_task function with your analysis.`;

  const tools = [
    {
      type: "function",
      function: {
        name: "parse_task",
        description: "Parse an accounting task into structured data",
        parameters: {
          type: "object",
          properties: {
            language: {
              type: "string",
              enum: ["nb", "nn", "en", "es", "pt", "de", "fr", "unknown"],
              description: "Detected language of the input",
            },
            normalizedPrompt: {
              type: "string",
              description: "The task translated/normalized to English",
            },
            intent: {
              type: "string",
              enum: ["create", "update", "delete", "list", "get", "link", "reverse", "unknown"],
            },
            resourceType: {
              type: "string",
              enum: [
                "employee", "customer", "product", "invoice", "payment",
                "creditNote", "project", "travelExpense", "department",
                "order", "account", "voucher", "contact", "address", "activity", "unknown",
              ],
            },
            fields: {
              type: "object",
              description: "Key-value pairs of fields extracted from the task. Include all data mentioned.",
              additionalProperties: true,
            },
            dependencies: {
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
              description: "Dependencies between steps if the task requires multiple related resources",
            },
            confidence: {
              type: "number",
              description: "Confidence 0-1 in the parsing",
            },
            notes: {
              type: "string",
              description: "Any notes about ambiguity or assumptions",
            },
          },
          required: ["language", "normalizedPrompt", "intent", "resourceType", "fields", "dependencies", "confidence", "notes"],
          additionalProperties: false,
        },
      },
    },
  ];

  const response = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: taskPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "parse_task" } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error("LLM parse failed", { status: response.status, body: errText });
    throw new Error(`LLM parsing failed: ${response.status}`);
  }

  const result = await response.json();
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall) {
    logger.error("No tool call in LLM response", { result });
    throw new Error("LLM did not return structured output");
  }

  const parsed: ParsedTask = JSON.parse(toolCall.function.arguments);
  // Ensure fields is always an object (LLM sometimes omits it)
  if (!parsed.fields || typeof parsed.fields !== "object") {
    parsed.fields = {};
    logger.warn("LLM omitted fields, defaulting to empty object");
  }
  logger.info("Task parsed", {
    language: parsed.language,
    intent: parsed.intent,
    resourceType: parsed.resourceType,
    confidence: parsed.confidence,
  });

  return parsed;
}
