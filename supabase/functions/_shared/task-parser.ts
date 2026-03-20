import { Logger } from "./logger.ts";
import { ParsedTask, Language, Intent, ResourceType } from "./types.ts";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
  "resourceType": "employee"|"customer"|"supplier"|"product"|"invoice"|"payment"|"creditNote"|"project"|"travelExpense"|"department"|"order"|"account"|"voucher"|"contact"|"address"|"activity"|"unknown",
  "fields": { ... all extracted data values ... },
  "dependencies": [],
  "confidence": 0.0-1.0,
  "notes": "any assumptions"
}

TRIPLETEX FIELD SCHEMAS — use EXACTLY these field names in "fields":

CUSTOMER / SUPPLIER:
  "name" (REQUIRED), "email", "phoneNumber", "organizationNumber", "invoiceEmail",
  "isCustomer" (true for customer), "isSupplier" (true for supplier),
  "accountManager" (name of account manager),
  Address: "address" (street), "postalCode", "city", "country" (ISO 3166 name, e.g. "Norge", "Norway")
  Website/URL: "url"

EMPLOYEE:
  "firstName" (REQUIRED), "lastName" (REQUIRED), "email", "phoneNumberMobile",
  "dateOfBirth" (YYYY-MM-DD), "startDate" (YYYY-MM-DD, employment start),
  "nationality", "number" (employee number),
  Admin: "isAccountAdministrator": true when task says admin/administrator/kontoadministrator

PRODUCT:
  "name" (REQUIRED), "number" (product code/SKU),
  "priceExcludingVatCurrency" (number, price without VAT),
  "costExcludingVatCurrency" (number, cost/innkjøpspris),
  "description", "unit" (e.g. "stk", "kg", "timer", "pcs", "hours"),
  "vatRate" (number, e.g. 25), "isInactive": false

INVOICE:
  "customerName" (REQUIRED), "customerEmail", "customerPhone",
  "organizationNumber" (customer org nr),
  "invoiceDate" (YYYY-MM-DD), "dueDate" (YYYY-MM-DD),
  "lineItems": [{"description":"...", "quantity":N, "unitPrice":N, "vatRate":N}],
  "comment", "currency" (e.g. "NOK")

ORDER:
  "customerName" (REQUIRED), "orderDate" (YYYY-MM-DD), "deliveryDate" (YYYY-MM-DD),
  "lineItems": [{"description":"...", "quantity":N, "unitPrice":N}],
  "receiver" (delivery recipient name)

PAYMENT:
  "invoiceId" or "invoiceNumber" or "customerName" (to find invoice),
  "amount" (number), "paymentDate" (YYYY-MM-DD),
  "paymentTypeId" (number, payment method)

CREDIT NOTE:
  "invoiceId" or "invoiceNumber" or "customerName",
  "amount" (for partial credit), "reason"

PROJECT:
  "name" (REQUIRED), "number", "description",
  "startDate" (YYYY-MM-DD), "endDate" (YYYY-MM-DD),
  "customerName" (linked customer), "projectManager" (employee name),
  Customer details: "customerEmail", "organizationNumber", "address"

DEPARTMENT:
  "name" (REQUIRED), "departmentNumber" (numeric string),
  "departmentManager" (employee name)

TRAVEL EXPENSE:
  "employeeName" or "employeeEmail" (REQUIRED to find employee),
  "title" (expense report title/purpose),
  "departureDate" (YYYY-MM-DD), "returnDate" (YYYY-MM-DD),
  "departure" (from location), "destination" (to location),
  "description", "isCompleted": true/false,
  Cost details if given: "amount", "currency"

VOUCHER:
  "date" (YYYY-MM-DD), "description",
  "postings": [{"debitAccount":N, "creditAccount":N, "amount":N, "description":"..."}]

CONTACT:
  "firstName", "lastName", "email", "phoneNumber",
  "customerName" (linked customer)

CRITICAL RULES:
1. "fields" MUST contain ALL data values from the task — do not omit anything.
2. Use the EXACT field names listed above. Do not invent new names.
3. For multi-entity tasks (e.g. "create project for customer X"), set resourceType to the PRIMARY entity.
4. Extract ALL related entity details into fields (customer info, employee info, etc.).
5. For suppliers, set resourceType to "supplier".
6. Numbers should be actual numbers, not strings (prices, amounts, quantities, VAT rates).
7. Dates MUST be YYYY-MM-DD format. Convert "1. januar 2024" to "2024-01-01".
8. For address fields, extract street, postal code, city, and country SEPARATELY.
9. Phone numbers: keep as string with any formatting ("+47 123 45 678").
10. Organization numbers: keep as string ("987654321").
11. If someone should be "administrator" or "kontoadministrator", set "isAccountAdministrator": true.
12. For travel expenses, "title" = the purpose/name of the trip.
13. For products, "unit" = the unit of measurement mentioned (stk, kg, timer, etc.).

Example: "Opprett prosjekt Alfa for kunde Firma AS (org.nr 999888777, e-post a@b.no, Storgata 1, 0123 Oslo)" →
{"language":"nb","normalizedPrompt":"Create project Alfa for customer Firma AS","intent":"create","resourceType":"project","fields":{"name":"Alfa","customerName":"Firma AS","organizationNumber":"999888777","customerEmail":"a@b.no","address":"Storgata 1","postalCode":"0123","city":"Oslo","country":"Norge"},"dependencies":[],"confidence":0.95,"notes":"Customer may need to be created first"}`;

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");

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
