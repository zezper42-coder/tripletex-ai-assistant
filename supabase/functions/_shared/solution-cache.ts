// Solution cache — stores and retrieves successful execution plans for reuse

import { Logger } from "./logger.ts";
import { ParsedTask, ExecutionPlan } from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/**
 * Generate a signature for a task that captures its essential pattern.
 * Similar tasks (same type + intent + similar field keys) get the same signature.
 */
export function generateTaskSignature(parsed: ParsedTask): string {
  const fieldKeys = Object.keys(parsed.fields).sort().join(",");
  return `${parsed.intent}:${parsed.resourceType}:${fieldKeys}`;
}

/**
 * Look up a cached solution for this task pattern.
 */
export async function findCachedSolution(
  parsed: ParsedTask,
  logger: Logger
): Promise<ExecutionPlan | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    logger.warn("Supabase credentials not available for solution cache");
    return null;
  }

  const signature = generateTaskSignature(parsed);
  logger.info(`Looking up cached solution for signature: ${signature}`);

  try {
    const url = `${SUPABASE_URL}/rest/v1/learned_solutions?task_signature=eq.${encodeURIComponent(signature)}&order=success_count.desc&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      logger.warn("Cache lookup failed", { status: response.status });
      return null;
    }

    const rows = await response.json();
    if (!rows || rows.length === 0) {
      logger.info("No cached solution found");
      return null;
    }

    const cached = rows[0];
    logger.info(`Found cached solution (used ${cached.success_count} time(s))`, {
      id: cached.id,
    });

    // Update last_used_at and increment success_count (fire-and-forget)
    updateUsageCount(cached.id, cached.success_count, logger);

    return cached.execution_plan as ExecutionPlan;
  } catch (err) {
    logger.warn("Cache lookup error", { error: String(err) });
    return null;
  }
}

/**
 * Save a successful execution plan for future reuse.
 */
export async function saveSolution(
  parsed: ParsedTask,
  plan: ExecutionPlan,
  logger: Logger
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const signature = generateTaskSignature(parsed);
  const taskType = `${parsed.resourceType}_${parsed.intent}`;

  logger.info(`Saving solution for signature: ${signature}`);

  try {
    // Check if a solution with this signature already exists
    const checkUrl = `${SUPABASE_URL}/rest/v1/learned_solutions?task_signature=eq.${encodeURIComponent(signature)}&limit=1`;
    const checkResponse = await fetch(checkUrl, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (checkResponse.ok) {
      const existing = await checkResponse.json();
      if (existing && existing.length > 0) {
        // Update existing — increment count and update plan
        await updateExisting(existing[0].id, existing[0].success_count, plan, logger);
        return;
      }
    }

    // Insert new solution
    const insertUrl = `${SUPABASE_URL}/rest/v1/learned_solutions`;
    const response = await fetch(insertUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        task_type: taskType,
        intent: parsed.intent,
        resource_type: parsed.resourceType,
        task_signature: signature,
        execution_plan: plan,
      }),
    });

    if (response.ok) {
      logger.info("Solution saved successfully");
    } else {
      logger.warn("Failed to save solution", { status: response.status });
    }
  } catch (err) {
    logger.warn("Solution save error", { error: String(err) });
  }
}

async function updateExisting(
  id: string,
  currentCount: number,
  plan: ExecutionPlan,
  logger: Logger
): Promise<void> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/learned_solutions?id=eq.${id}`;
    await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        success_count: currentCount + 1,
        last_used_at: new Date().toISOString(),
        execution_plan: plan,
      }),
    });
    logger.info(`Updated existing solution (count: ${currentCount + 1})`);
  } catch (err) {
    logger.warn("Failed to update existing solution", { error: String(err) });
  }
}

async function updateUsageCount(
  id: string,
  currentCount: number,
  logger: Logger
): Promise<void> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/learned_solutions?id=eq.${id}`;
    await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        last_used_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Fire and forget
  }
}
