// Contact creation executor — POST /v2/contact

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeContactCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:contact");
  const f = parsed.fields ?? {};

  let firstName = (f.firstName ?? f.fornavn) as string | undefined;
  let lastName = (f.lastName ?? f.etternavn ?? f.surname) as string | undefined;
  if (!firstName && !lastName && f.name) {
    const parts = String(f.name).trim().split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(" ") || parts[0];
  }

  const email = (f.email ?? f.epost) as string | undefined;
  const phone = (f.phoneNumber ?? f.phone ?? f.telefon) as string | undefined;
  const customerName = (f.customerName ?? f.customer ?? f.kunde) as string | undefined;

  if (!firstName) {
    return {
      plan: { summary: "Contact creation failed: name required", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: "firstName is required", duration: 0 }],
      verified: false,
    };
  }

  // Resolve customer if referenced
  let customerId: number | undefined;
  const steps: ExecutionPlan["steps"] = [];
  const stepResults: StepResult[] = [];
  let stepNum = 0;

  if (customerName) {
    stepNum++;
    const searchRes = await client.get("/v2/customer", { name: String(customerName), count: "1", fields: "id,name" });
    if (searchRes.status === 200) {
      const vals = ((searchRes.data as any)?.values ?? []) as Array<{ id: number }>;
      if (vals.length > 0) customerId = vals[0].id;
    }
  }

  const body: Record<string, unknown> = {
    firstName,
    lastName: lastName || firstName,
    ...(email && { email: email.trim() }),
    ...(phone && { phoneNumber: String(phone).trim() }),
    ...(customerId && { customer: { id: customerId } }),
  };

  stepNum++;
  steps.push({
    stepNumber: stepNum,
    description: `POST /v2/contact — create "${firstName} ${lastName || ""}"`,
    method: "POST",
    endpoint: "/v2/contact",
    body,
    resultKey: "contactId",
  });

  log.info("Creating contact", { body });
  const start = Date.now();
  const response = await client.post("/v2/contact", body);
  const duration = Date.now() - start;
  const success = response.status >= 200 && response.status < 300;

  stepResults.push({
    stepNumber: stepNum,
    success,
    statusCode: response.status,
    data: response.data,
    duration,
    ...(!success && { error: `Tripletex returned ${response.status}` }),
  });

  if (success) {
    const id = extractId(response.data);
    log.info(`Contact created with ID ${id}`);
  }

  return {
    plan: { summary: `Create contact: ${firstName} ${lastName || ""}`, steps },
    stepResults,
    verified: success,
  };
}

function extractId(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (d.value && typeof d.value === "object") {
    const v = d.value as Record<string, unknown>;
    if (typeof v.id === "number") return v.id;
  }
  if (typeof d.id === "number") return d.id;
  return undefined;
}
