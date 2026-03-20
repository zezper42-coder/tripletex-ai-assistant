// Ledger voucher executor — Tier 3 accounting tasks

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

export async function executeVoucherCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:voucher");
  const fields = parsed.fields ?? {};

  const steps: ExecutionPlan["steps"] = [];
  const stepResults: StepResult[] = [];

  // Extract voucher fields
  const date = (fields.date ?? fields.dato ?? new Date().toISOString().slice(0, 10)) as string;
  const description = (fields.description ?? fields.beskrivelse ?? fields.text ?? parsed.normalizedPrompt?.slice(0, 80) ?? "Voucher") as string;

  // Extract postings (debit/credit lines)
  const postings = (fields.postings ?? fields.lines ?? fields.posteringer ?? []) as Array<{
    debitAccount?: number | string;
    creditAccount?: number | string;
    account?: number | string;
    amount?: number | string;
    amountGross?: number | string;
    description?: string;
  }>;

  // Build voucher body
  const voucherPostings: Array<Record<string, unknown>> = [];

  if (postings.length > 0) {
    for (const p of postings) {
      const amount = Number(p.amount ?? p.amountGross ?? 0);
      if (p.debitAccount) {
        voucherPostings.push({
          account: { id: Number(p.debitAccount) },
          amountGross: amount,
          ...(p.description && { description: p.description }),
        });
      }
      if (p.creditAccount) {
        voucherPostings.push({
          account: { id: Number(p.creditAccount) },
          amountGross: -amount,
          ...(p.description && { description: p.description }),
        });
      }
      if (p.account && !p.debitAccount && !p.creditAccount) {
        voucherPostings.push({
          account: { id: Number(p.account) },
          amountGross: amount,
          ...(p.description && { description: p.description }),
        });
      }
    }
  } else {
    // Try to build from flat fields
    const debitAccount = fields.debitAccount ?? fields.debitkonto;
    const creditAccount = fields.creditAccount ?? fields.kreditkonto;
    const amount = Number(fields.amount ?? fields.beløp ?? 0);

    if (debitAccount && creditAccount && amount) {
      voucherPostings.push(
        { account: { id: Number(debitAccount) }, amountGross: amount },
        { account: { id: Number(creditAccount) }, amountGross: -amount },
      );
    }
  }

  if (voucherPostings.length === 0) {
    log.error("No valid postings could be built for voucher");
    return {
      plan: { summary: "Voucher creation failed: no postings", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: "No valid debit/credit postings found", duration: 0 }],
      verified: false,
    };
  }

  const body = {
    date,
    description,
    postings: voucherPostings,
  };

  steps.push({
    stepNumber: 1,
    description: `POST /v2/ledger/voucher — "${description}"`,
    method: "POST" as const,
    endpoint: "/v2/ledger/voucher",
    body,
    resultKey: "voucherId",
  });

  log.info("Creating voucher", { postingCount: voucherPostings.length });
  const start = Date.now();
  const res = await client.postWithRetry("/v2/ledger/voucher", body);
  const success = res.status >= 200 && res.status < 300;

  stepResults.push({
    stepNumber: 1,
    success,
    statusCode: res.status,
    data: res.data,
    duration: Date.now() - start,
    ...(!success && { error: `Tripletex returned ${res.status}` }),
  });

  return {
    plan: { summary: `Create voucher: ${description}`, steps },
    stepResults,
    verified: success,
  };
}
