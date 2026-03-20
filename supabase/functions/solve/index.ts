import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runPipeline } from "../_shared/agent-pipeline.ts";
import { SolveRequest } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();

    // Validate required fields
    const { task, tripletexApiUrl, sessionToken, mockMode, attachments } = body;

    if (!task || typeof task !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'task' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!mockMode && (!tripletexApiUrl || !sessionToken)) {
      return new Response(
        JSON.stringify({ error: "Missing 'tripletexApiUrl' or 'sessionToken'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const solveRequest: SolveRequest = {
      task,
      tripletexApiUrl: tripletexApiUrl || "https://api.tripletex.io",
      sessionToken: sessionToken || "",
      mockMode: !!mockMode,
      attachments: attachments || [],
    };

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[solve] Starting task processing (mock=${solveRequest.mockMode})`);

    const result = await runPipeline(solveRequest, apiKey);

    console.log(`[solve] Completed in ${Date.now() - startTime}ms — status: ${result.status}`);

    // The competition expects {"status":"completed"}
    // But we also return full debug info for our test UI
    const isCompetition = req.headers.get("x-debug") !== "true";

    if (isCompetition) {
      return new Response(
        JSON.stringify({ status: result.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Debug mode: return full pipeline result
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[solve] Fatal error:", err);
    return new Response(
      JSON.stringify({
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
        duration: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
