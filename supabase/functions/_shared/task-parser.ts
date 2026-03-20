import { Logger } from "./logger.ts";
import { ParsedTask, Language, Intent, ResourceType } from "./types.ts";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function parseTask(
  taskPrompt: string,
  apiKey: string,
  logger: Logger
): Promise<ParsedTask> {
  logger.info("Parsing task with LLM", { promptLength: taskPrompt.length });

  const systemPrompt = `You are an expert accounting task parser for Tripletex ERP.
Given a task description (possibly in Norwegian, English, Spanish, Portuguese, Nynorsk, German, or French), extract structured information.

Respond with ONLY a JSON object (no markdown, no explanation) with these exact fields:
{
  "language": "nb"|"nn"|"en"|"es"|"pt"|"de"|"fr"|"unknown",
  "normalizedPrompt": "task translated to English",
  "intent": "create"|"update"|"delete"|"list"|"get"|"link"|"reverse"|"unknown",
  "resourceType": "employee"|"customer"|"product"|"invoice"|"payment"|"creditNote"|"project"|"travelExpense"|"department"|"order"|"account"|"voucher"|"contact"|"address"|"activity"|"unknown",
  "fields": { ... all extracted data values ... },
  "dependencies": [],
  "confidence": 0.0-1.0,
  "notes": "any assumptions"
}

CRITICAL RULES:
1. The "fields" object MUST contain ALL data values from the task.
2. If the task mentions creating a project FOR a customer, resourceType is "project" and include customer details in fields.
3. If the task mentions creating an invoice FOR a customer, resourceType is "invoice" and include customer details in fields.
4. Extract ALL entity details even if they belong to related entities.

Field mapping:
- Customer/company name → "name" or "customerName"
- Email → "email"
- Phone → "phoneNumber"
- Organization number → "organizationNumber"
- Address → "address"
- Postal code → "postalCode"
- City → "city"
- First/last name → "firstName", "lastName"
- Product name → "name"
- Price → "priceExcludingVatCurrency": number
- VAT rate → "vatRate": number
- Invoice number → "invoiceNumber"
- Amount → "amount": number
- Date → "date": "YYYY-MM-DD"
- Start date → "startDate": "YYYY-MM-DD"
- End date → "endDate": "YYYY-MM-DD"
- Line items → "lineItems": [{"description": "...", "quantity": N, "unitPrice": N}]
- Department number → "departmentNumber"
- Project manager → "projectManager"
- Account administrator → "isAccountAdministrator": true

Example: "Opprett prosjekt Alfa for kunde Firma AS (org.nr 999888777, e-post a@b.no)" →
{"language":"nb","normalizedPrompt":"Create project Alfa for customer Firma AS (org number 999888777, email a@b.no)","intent":"create","resourceType":"project","fields":{"name":"Alfa","customerName":"Firma AS","organizationNumber":"999888777","email":"a@b.no"},"dependencies":[],"confidence":0.95,"notes":"Customer may need to be created first"}`;
  const response = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: taskPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error("LLM parse failed", { status: response.status, body: errText });
    throw new Error(`LLM parsing failed: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    logger.error("No content in LLM response", { result });
    throw new Error("LLM did not return content");
  }

  // Extract JSON from response (handle possible markdown code blocks)
  let jsonStr = content.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: ParsedTask;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    logger.error("Failed to parse LLM JSON", { content: jsonStr.slice(0, 500) });
    throw new Error(`LLM returned invalid JSON: ${e}`);
  }

  // Ensure fields is always an object
  if (!parsed.fields || typeof parsed.fields !== "object") {
    parsed.fields = {};
    logger.warn("LLM omitted fields, defaulting to empty object");
  }

  // Ensure dependencies is always an array
  if (!Array.isArray(parsed.dependencies)) {
    parsed.dependencies = [];
  }

  logger.info("Task parsed", {
    language: parsed.language,
    intent: parsed.intent,
    resourceType: parsed.resourceType,
    confidence: parsed.confidence,
    fieldCount: Object.keys(parsed.fields).length,
  });

  return parsed;
}
