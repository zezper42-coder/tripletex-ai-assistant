import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const baseUrl = Deno.env.get("TRIPLETEX_BASE_URL");
  const sessionToken = Deno.env.get("TRIPLETEX_SESSION_TOKEN");

  if (!baseUrl || !sessionToken) {
    return new Response(JSON.stringify({ error: "Missing TRIPLETEX_BASE_URL or TRIPLETEX_SESSION_TOKEN secrets" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const testType = body.test || "sanity";

    if (testType === "sanity") {
      // Basic GET /v2/customer to verify auth works
      const authHeader = "Basic " + btoa(`0:${sessionToken}`);
      // Strip /v2 suffix if present to avoid double-prefix
      const cleanBase = baseUrl.replace(/\/v2\/?$/, "");
      const url = `${cleanBase}/v2/customer?fields=id,name&count=3`;
      console.log("Sanity check URL:", url);
      const res = await fetch(url, {
        headers: { "Authorization": authHeader, "Accept": "application/json" },
      });
      const data = await res.text();
      return new Response(JSON.stringify({
        test: "sanity",
        tripletexStatus: res.status,
        baseUrl,
        actualUrl: url,
        response: JSON.parse(data),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (testType === "solve") {
      // Call the solve function with real credentials
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      const prompt = body.prompt || "Opprett en ny kunde med navn Sandbox Test AS og e-post sandbox@test.no";

      const solveRes = await fetch(`${supabaseUrl}/functions/v1/solve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`,
          "apikey": anonKey,
          "x-debug": "true",
        },
        body: JSON.stringify({
          prompt,
          files: [],
          tripletex_credentials: {
            base_url: baseUrl,
            session_token: sessionToken,
          },
        }),
      });
      const solveData = await solveRes.json();
      return new Response(JSON.stringify({
        test: "solve",
        solveStatus: solveRes.status,
        result: solveData,
      }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown test type. Use 'sanity' or 'solve'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
