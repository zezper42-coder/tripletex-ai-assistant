import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SOLVE_URL = `${SUPABASE_URL}/functions/v1/solve`;

// ── Helper ──────────────────────────────────────────────────────────────
async function callSolve(body: Record<string, unknown>, debug = true) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "apikey": SUPABASE_ANON_KEY,
  };
  if (debug) headers["x-debug"] = "true";
  const res = await fetch(SOLVE_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json();
  return { status: res.status, data };
}

// ── Mock-mode tests ─────────────────────────────────────────────────────

Deno.test("mock: customer_create (nb) routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Opprett en ny kunde med navn Testfirma AS, e-post post@test.no",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
  assertExists(data.parsedTask);
  assertEquals(data.parsedTask.resourceType, "customer");
  assertEquals(data.parsedTask.intent, "create");
});

Deno.test("mock: invoice_create (en) routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Create an invoice for Acme Corp for 10 hours consulting at 200 NOK",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
  assertEquals(data.parsedTask.resourceType, "invoice");
});

Deno.test("mock: credit_note routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Opprett kreditnota for faktura 10025",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
  assertEquals(data.parsedTask.resourceType, "creditNote");
});

Deno.test("mock: payment routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Registrer betaling på faktura 10001, beløp 4500 NOK",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
  assertEquals(data.parsedTask.resourceType, "payment");
});

Deno.test("mock: department_create routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Opprett avdeling Regnskap med avdelingsnummer 30",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
  assertEquals(data.parsedTask.resourceType, "department");
});

Deno.test("mock: travel_expense_create routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Opprett reiseregning for Ola Nordmann, tog Bergen-Oslo, 18. mars 2026, 1250 NOK",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
});

Deno.test("mock: product_create routes correctly", async () => {
  const { status, data } = await callSolve({
    task: "Opprett produkt 'Rådgivning Standard' med pris 2000 NOK og 25% MVA",
    mockMode: true,
  });
  assertEquals(status, 200);
  assertEquals(data.status, "completed");
  assertEquals(data.parsedTask.resourceType, "product");
});

Deno.test("mock: compat status in debug output", async () => {
  const { data } = await callSolve({
    task: "Opprett en ny kunde Testfirma",
    mockMode: true,
  });
  assertExists(data._compatStatus);
  assertExists(data._compatStatus.confirmed);
  assertExists(data._compatStatus.todo_needs_live_test);
});

Deno.test("mock: non-debug response is minimal", async () => {
  const { data } = await callSolve(
    { task: "Opprett en ny kunde Testfirma", mockMode: true },
    false,
  );
  assertEquals(data.status, "completed");
  assertEquals(Object.keys(data).length, 1); // only { status }
});

Deno.test("validation: missing task returns 400", async () => {
  const { status } = await callSolve({ task: "", mockMode: true });
  assertEquals(status, 400);
});
