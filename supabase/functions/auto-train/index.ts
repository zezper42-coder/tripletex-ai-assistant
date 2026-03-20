import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runPipeline } from "../_shared/agent-pipeline.ts";
import { SolveRequest } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESOURCE_TYPES = [
  "customer", "employee", "invoice", "payment", "creditNote",
  "voucher", "travelExpense", "project", "department", "supplier",
  "contact", "product",
];

const INTENTS = ["create", "update", "delete", "list"];
const LANGUAGES = ["nb", "nn", "en", "de", "es", "pt", "fr"];

const TASK_GENERATION_PROMPT = `You are a test generator for a Tripletex accounting system AI agent.

Generate a SINGLE realistic accounting task prompt that a user would send to an AI agent connected to Tripletex.

Requirements:
- The task MUST be for resource type: {resourceType}
- The task MUST be intent: {intent}
- The task MUST be written in language: {language}
- Include realistic Norwegian names, addresses, emails, phone numbers, amounts, dates
- Vary complexity: some simple (single entity), some complex (multi-step with prerequisites)
- Include specific details like VAT rates, account numbers, project codes when relevant
- Sometimes reference attachments (but don't actually create them)
- Make tasks that test edge cases: special characters (æøå), long names, zero amounts, future dates
- Be creative and realistic — these should look like real accounting tasks

IMPORTANT:
- Return exactly ONE non-empty task prompt
- Do not return labels, headings, JSON, markdown, bullets, or explanations
- Do not return an empty response
- The prompt must be directly usable as the task input for /solve

Examples of good tasks:
- "Opprett en ny kunde: Nordfjord Elektro AS, org.nr 987654321, adresse Storgata 15, 6770 Nordfjordeid, e-post post@nordfjord-elektro.no"
- "Create an invoice for customer Hansen & Sønn AS: 3x Product A at 1250 NOK each, 25% VAT, due date 2025-02-15"
- "Registrer en reiseregning for ansatt Kari Nordmann: Oslo-Bergen tur/retur 15.01.2025, diett 2 dager, hotell 1890 kr"
- "Slett reiseregning #4523 for Per Olsen"
- "Erstatte ein ansatt si e-postadresse: Ola Nordmann skal ha ola.nordmann@firma.no"`;

interface TrainResult {
  task: string;
  category: string;
  language: string;
  status: "completed" | "failed";
  swarmUsed: boolean;
  duration: number;
  error?: string;
  solutionLearned: boolean;
}

function normalizeTaskText(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text|json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^task\s*:\s*/i, "")
    .replace(/^prompt\s*:\s*/i, "")
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .trim();
}

function extractTaskText(data: unknown): string {
  if (!data || typeof data !== "object") return "";

  const root = data as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = (choices[0] && typeof choices[0] === "object")
    ? (choices[0] as Record<string, unknown>)
    : null;
  const message = firstChoice?.message && typeof firstChoice.message === "object"
    ? (firstChoice.message as Record<string, unknown>)
    : null;

  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== "object") continue;
    const fn = (toolCall as Record<string, unknown>).function;
    if (!fn || typeof fn !== "object") continue;
    const args = (fn as Record<string, unknown>).arguments;
    if (typeof args !== "string") continue;

    try {
      const parsedArgs = JSON.parse(args) as Record<string, unknown>;
      if (typeof parsedArgs.task === "string") {
        const task = normalizeTaskText(parsedArgs.task);
        if (task) return task;
      }
    } catch {
      // Ignore malformed tool arguments and fall back to content parsing.
    }
  }

  const content = message?.content;
  if (typeof content === "string") {
    return normalizeTaskText(content);
  }

  if (Array.isArray(content)) {
    const combined = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const text = (part as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .join("\n");

    return normalizeTaskText(combined);
  }

  const outputText = message?.output_text ?? firstChoice?.output_text ?? root.output_text;
  if (typeof outputText === "string") {
    return normalizeTaskText(outputText);
  }

  return "";
}

async function generateTask(
  apiKey: string,
  resourceType: string,
  intent: string,
  language: string,
  previousTasks: string[] = [],
): Promise<string> {
  let uniquenessClause = "";
  if (previousTasks.length > 0) {
    const listed = previousTasks.map((t, i) => `${i + 1}. "${t.substring(0, 120)}"`).join("\n");
    uniquenessClause = `\n\nCRITICAL — The following tasks have ALREADY been generated. You MUST create a COMPLETELY DIFFERENT task with different names, amounts, dates, companies, and details. Never repeat or paraphrase these:\n${listed}`;
  }

  const prompt = TASK_GENERATION_PROMPT
    .replace("{resourceType}", resourceType)
    .replace("{intent}", intent)
    .replace("{language}", language) + uniquenessClause;

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: attempt === 0
              ? `Generate a unique ${intent} task for ${resourceType} in ${language}. Use creative, original names and data not seen before.`
              : `Previous response was empty. Return exactly one non-empty, UNIQUE ${language} task prompt for ${resourceType} with intent ${intent}. Plain text only. Do not repeat any previous task.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_task",
              description: "Return exactly one realistic Tripletex task prompt.",
              parameters: {
                type: "object",
                properties: {
                  task: { type: "string" },
                },
                required: ["task"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_task" } },
        
        max_completion_tokens: 500,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Task generation failed: ${resp.status} ${err}`);
    }

    const data = await resp.json();
    const task = extractTaskText(data);
    if (task) {
      return task;
    }

    console.warn("[auto-train] Empty task generation response", {
      resourceType,
      intent,
      language,
      attempt: attempt + 1,
      finishReason: data?.choices?.[0]?.finish_reason,
    });
  }

  throw new Error("LLM returned empty task after 3 attempts");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      tripletexApiUrl = "https://api.tripletex.io",
      sessionToken = "",
      iterations = 10,
      categories = [],
      mockMode = false,
    } = body;

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!mockMode && !sessionToken) {
      return new Response(JSON.stringify({ error: "sessionToken required when not in mockMode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const activeResources = categories.length > 0
      ? categories.filter((c: string) => RESOURCE_TYPES.includes(c))
      : RESOURCE_TYPES;

    const results: TrainResult[] = [];
    const generatedTasks: string[] = []; // Track all generated tasks for uniqueness
    let succeeded = 0;
    let failed = 0;
    let newSolutionsLearned = 0;

    const maxIterations = Math.min(iterations, 50);

    for (let i = 0; i < maxIterations; i++) {
      const resourceType = activeResources[i % activeResources.length];
      const intent = INTENTS[Math.floor(Math.random() * INTENTS.length)];
      const language = LANGUAGES[Math.floor(Math.random() * LANGUAGES.length)];
      const category = `${resourceType}_${intent}`;

      console.log(`[auto-train] Iteration ${i + 1}/${maxIterations}: ${category} (${language})`);

      let taskText = "";
      try {
        taskText = await generateTask(gatewayKey, resourceType, intent, language, generatedTasks);
      } catch (err) {
        console.error(`[auto-train] Task generation failed:`, err);
        results.push({
          task: `[generation failed]`,
          category,
          language,
          status: "failed",
          swarmUsed: false,
          duration: 0,
          error: err instanceof Error ? err.message : String(err),
          solutionLearned: false,
        });
        failed++;
        continue;
      }

      if (!taskText) {
        results.push({
          task: "[empty task]",
          category,
          language,
          status: "failed",
          swarmUsed: false,
          duration: 0,
          error: "GPT returned empty task",
          solutionLearned: false,
        });
        failed++;
        continue;
      }

      // Track for uniqueness
      generatedTasks.push(taskText);

      const solveRequest: SolveRequest = {
        task: taskText,
        tripletexApiUrl,
        sessionToken,
        mockMode: !!mockMode,
      };

      const iterStart = Date.now();
      try {
        const pipelineResult = await runPipeline(solveRequest, gatewayKey);
        const duration = Date.now() - iterStart;

        const swarmUsed = pipelineResult.logs.some(
          (l) => l.module === "swarm" || l.message.toLowerCase().includes("swarm")
        );
        const solutionLearned = pipelineResult.logs.some(
          (l) => l.message.toLowerCase().includes("saved") && l.message.toLowerCase().includes("solution")
        );

        if (pipelineResult.status === "completed") {
          succeeded++;
          if (solutionLearned) newSolutionsLearned++;
        } else {
          failed++;
        }

        results.push({
          task: taskText.substring(0, 200),
          category,
          language,
          status: pipelineResult.status,
          swarmUsed,
          duration,
          error: pipelineResult.error,
          solutionLearned,
        });
      } catch (err) {
        failed++;
        results.push({
          task: taskText.substring(0, 200),
          category,
          language,
          status: "failed",
          swarmUsed: false,
          duration: Date.now() - iterStart,
          error: err instanceof Error ? err.message : String(err),
          solutionLearned: false,
        });
      }
    }

    return new Response(
      JSON.stringify({
        totalRuns: results.length,
        succeeded,
        failed,
        newSolutionsLearned,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[auto-train] Fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});