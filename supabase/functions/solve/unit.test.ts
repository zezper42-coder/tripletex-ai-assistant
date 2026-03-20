// Unit tests for heuristics, compat layer, and task routing
// These run without network access

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runHeuristics } from "../_shared/heuristics.ts";
import { getCompatDebugSummary, getUnverifiedBehaviors, BEHAVIOR_REGISTRY } from "../_shared/tripletex-compat.ts";
import { resolveTaskType, listSupportedTaskTypes } from "../_shared/task-router.ts";
import { Logger } from "../_shared/logger.ts";

const logger = new Logger("test");

// ── Heuristics ──────────────────────────────────────────────────────────

Deno.test("heuristics: detects nb customer_create", () => {
  const r = runHeuristics("Opprett en ny kunde med navn Nordvik AS, e-post kontakt@nordvik.no", logger);
  assertEquals(r.likelyResource, "customer");
  assertEquals(r.likelyAction, "create");
  assertEquals(r.confidenceBoost > 0, true);
  assertEquals(r.signals.includes("has_email"), true);
});

Deno.test("heuristics: detects de employee_create", () => {
  const r = runHeuristics("Erstellen Sie einen neuen Mitarbeiter Hans Müller", logger);
  assertEquals(r.likelyResource, "employee");
  assertEquals(r.likelyAction, "create");
});

Deno.test("heuristics: detects es travel_expense_delete", () => {
  const r = runHeuristics("Eliminar el gasto de viaje del 15 de marzo por 1500 NOK", logger);
  assertEquals(r.likelyResource, "travelExpense");
  assertEquals(r.likelyAction, "delete");
});

Deno.test("heuristics: credit note takes priority over invoice", () => {
  const r = runHeuristics("Opprett kreditnota for faktura 10025", logger);
  assertEquals(r.likelyResource, "creditNote");
});

Deno.test("heuristics: payment detection (nb)", () => {
  const r = runHeuristics("Registrer betaling på 5000 NOK", logger);
  assertEquals(r.likelyResource, "payment");
});

Deno.test("heuristics: department detection (fr)", () => {
  const r = runHeuristics("Créer un nouveau département Ressources Humaines", logger);
  assertEquals(r.likelyResource, "department");
  assertEquals(r.likelyAction, "create");
});

Deno.test("heuristics: org number boosts confidence", () => {
  const r = runHeuristics("Opprett kunde Firma AS med orgnr 987654321", logger);
  assertEquals(r.signals.includes("has_org_number"), true);
  assertEquals(r.confidenceBoost >= 0.15, true);
});

// ── Task Router ─────────────────────────────────────────────────────────

Deno.test("router: resolves known task types", () => {
  assertEquals(resolveTaskType("create", "customer"), "customer_create");
  assertEquals(resolveTaskType("create", "invoice"), "invoice_create");
  assertEquals(resolveTaskType("delete", "travelExpense"), "travel_expense_delete");
  assertEquals(resolveTaskType("create", "creditNote"), "creditNote_create");
  assertEquals(resolveTaskType("create", "payment"), "payment_create");
});

Deno.test("router: returns unknown for unsupported combos", () => {
  assertEquals(resolveTaskType("update", "customer"), "unknown");
  assertEquals(resolveTaskType("delete", "invoice"), "unknown");
});

Deno.test("router: lists all supported task types", () => {
  const types = listSupportedTaskTypes();
  assertEquals(types.includes("customer_create"), true);
  assertEquals(types.includes("invoice_create"), true);
  assertEquals(types.includes("creditNote_create"), true);
  assertEquals(types.length >= 10, true);
});

// ── Compat Layer ────────────────────────────────────────────────────────

Deno.test("compat: behavior registry has entries", () => {
  assertEquals(BEHAVIOR_REGISTRY.length > 0, true);
});

Deno.test("compat: debug summary groups correctly", () => {
  const summary = getCompatDebugSummary();
  assertExists(summary.confirmed);
  assertExists(summary.unconfirmed_safe);
  assertExists(summary.todo_needs_live_test);
  assertEquals(summary.confirmed.length > 0, true);
  assertEquals(summary.todo_needs_live_test.length > 0, true);
});

Deno.test("compat: unverified behaviors returns non-confirmed", () => {
  const unverified = getUnverifiedBehaviors();
  for (const b of unverified) {
    assertEquals(b.status !== "confirmed", true);
  }
});

Deno.test("compat: all statuses are valid", () => {
  const valid = new Set(["confirmed", "unconfirmed_safe", "todo_needs_live_test"]);
  for (const b of BEHAVIOR_REGISTRY) {
    assertEquals(valid.has(b.status), true);
  }
});
