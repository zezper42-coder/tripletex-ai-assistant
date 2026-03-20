import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runPipeline } from "../_shared/agent-pipeline.ts";
import { SolveRequest } from "../_shared/types.ts";
import { getCompatDebugSummary } from "../_shared/tripletex-compat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-debug, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Support both competition schema and internal schema
    const task = body.task || body.prompt || "";
    const tripletexApiUrl =
      body.tripletexApiUrl ||
      body.tripletex_credentials?.base_url ||
      "";
    const sessionToken =
      body.sessionToken ||
      body.tripletex_credentials?.session_token ||
      "";
    const mockMode = body.mockMode ?? false;

    // Normalize attachments from either format
    const attachments = body.attachments || (body.files || []).map((f: any) => ({
      filename: f.filename,
      mimeType: f.mime_type || f.mimeType,
      base64: f.content_base64 || f.base64,
      url: f.url,
    }));

    if (!task || typeof task !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'task' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!mockMode && (!tripletexApiUrl || !sessionToken)) {
      return new Response(
        JSON.stringify({ error: "Missing Tripletex credentials (tripletexApiUrl/sessionToken or tripletex_credentials)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const solveRequest: SolveRequest = {
      task,
      tripletexApiUrl: tripletexApiUrl || "https://api.tripletex.io",
      sessionToken: sessionToken || "",
      mockMode: !!mockMode,
      attachments,
    };

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[solve] Starting (mock=${solveRequest.mockMode}, attachments=${attachments.length})`);

    const result = await runPipeline(solveRequest, apiKey);

    console.log(`[solve] Done in ${Date.now() - startTime}ms — status: ${result.status}`);

    // Competition mode: minimal response. Debug mode: full pipeline result.
    const isDebug = req.headers.get("x-debug") === "true";

    if (!isDebug) {
      return new Response(
        JSON.stringify({ status: result.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
