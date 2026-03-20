/**
 * Live Tripletex sandbox tests — requires real credentials.
 * Set environment variables before running:
 *   TRIPLETEX_BASE_URL=https://api.tripletex.io
 *   TRIPLETEX_SESSION_TOKEN=<your-session-token>
 *
 * Run with: deno test --allow-net --allow-env --allow-read supabase/functions/solve/sandbox-live.test.ts
 *
 * These tests hit the real /solve edge function with real Tripletex credentials.
 * They are skipped automatically if credentials are not set.
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const TRIPLETEX_BASE_URL = Deno.env.get("TRIPLETEX_BASE_URL");
const TRIPLETEX_SESSION_TOKEN = Deno.env.get("TRIPLETEX_SESSION_TOKEN");
const SOLVE_URL = `${SUPABASE_URL}/functions/v1/solve`;

const hasCredentials = !!TRIPLETEX_BASE_URL && !!TRIPLETEX_SESSION_TOKEN;

async function solveLive(task: string) {
  const res = await fetch(SOLVE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
      "x-debug": "true",
    },
    body: JSON.stringify({
      task,
      tripletexApiUrl: TRIPLETEX_BASE_URL,
      sessionToken: TRIPLETEX_SESSION_TOKEN,
      mockMode: false,
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// Helper to skip tests when no credentials
function liveTest(name: string, fn: () => Promise<void>) {
  if (!hasCredentials) {
    Deno.test({ name: `[SKIPPED - no credentials] ${name}`, fn: async () => {} });
    return;
  }
  Deno.test({ name: `[LIVE] ${name}`, fn, sanitizeResources: false, sanitizeOps: false });
}

// ── Live sandbox tests ──────────────────────────────────────────────────

liveTest("customer_create", async () => {
  const { status, data } = await solveLive(
    "Opprett en ny kunde med navn Sandbox Testfirma AS, e-post sandbox@test.no og telefon +47 99887766"
  );
  assertEquals(status, 200);
  console.log("Customer result:", JSON.stringify(data, null, 2));
  assertEquals(data.status, "completed");
  assertExists(data.stepResults);
  assertEquals(data.stepResults[0]?.success, true);
});

liveTest("department_create", async () => {
  const { status, data } = await solveLive(
    "Opprett avdeling Sandboxtest med avdelingsnummer 99"
  );
  assertEquals(status, 200);
  console.log("Department result:", JSON.stringify(data, null, 2));
  assertEquals(data.status, "completed");
});

liveTest("product_create with VAT", async () => {
  const { status, data } = await solveLive(
    "Opprett produkt 'Sandbox Rådgivning' med pris 2000 NOK og 25% MVA"
  );
  assertEquals(status, 200);
  console.log("Product result:", JSON.stringify(data, null, 2));
  // Log VAT activity from logs
  const vatLogs = (data.logs || []).filter((l: any) => l.module?.includes("vat"));
  console.log("VAT logs:", JSON.stringify(vatLogs, null, 2));
});

liveTest("employee_create", async () => {
  const { status, data } = await solveLive(
    "Opprett en ny ansatt med fornavn Sandbox, etternavn Testansen, e-post sandbox.test@example.no"
  );
  assertEquals(status, 200);
  console.log("Employee result:", JSON.stringify(data, null, 2));
  assertEquals(data.status, "completed");
});

liveTest("invoice_create (simple)", async () => {
  const { status, data } = await solveLive(
    "Opprett en faktura til kunde Sandbox Testfirma AS for 3 timer rådgivning à 1500 NOK"
  );
  assertEquals(status, 200);
  console.log("Invoice result:", JSON.stringify(data, null, 2));
  // Log compat variant info
  const compatLogs = (data.logs || []).filter((l: any) => l.module?.includes("compat"));
  console.log("Compat logs:", JSON.stringify(compatLogs, null, 2));
});

liveTest("payment registration", async () => {
  const { status, data } = await solveLive(
    "Registrer betaling på faktura 10001, beløp 4500 NOK, betalt i dag"
  );
  assertEquals(status, 200);
  console.log("Payment result:", JSON.stringify(data, null, 2));
});

liveTest("credit_note (full)", async () => {
  const { status, data } = await solveLive(
    "Opprett kreditnota for faktura 10001"
  );
  assertEquals(status, 200);
  console.log("Credit note result:", JSON.stringify(data, null, 2));
});

liveTest("travel_expense_create", async () => {
  const { status, data } = await solveLive(
    "Opprett reiseregning for Sandbox Testansen, tog Oslo-Bergen, 20. mars 2026, 1800 NOK"
  );
  assertEquals(status, 200);
  console.log("Travel expense result:", JSON.stringify(data, null, 2));
});
