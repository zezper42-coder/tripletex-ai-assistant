// Ledger voucher executor — Tier 3 accounting tasks

import { Logger } from "../logger.ts";
import { TripletexClient } from "../tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "../types.ts";
import { ExecutorResult } from "../task-router.ts";

interface ParsedPosting {
  debitAccount?: number | string;
  creditAccount?: number | string;
  account?: number | string;
  amount?: number | string;
  amountGross?: number | string;
  description?: string;
}

/**
 * Look up Tripletex internal account ID from an account number (e.g. 1920 → id 45678).
 * Caches results within a single execution run.
 */
async function resolveAccountId(
  accountNumber: number,
  client: TripletexClient,
  logger: Logger,
  cache: Map<number, number>
): Promise<number | null> {
  if (cache.has(accountNumber)) return cache.get(accountNumber)!;

  const res = await client.get("/v2/ledger/account", {
    number: String(accountNumber),
    fields: "id,number",
    count: "1",
  });

  if (res.status >= 200 && res.status < 300 && res.data) {
    const d = res.data as Record<string, unknown>;
    const values = (d.values ?? (d.value ? [d.value] : [])) as Record<string, unknown>[];
    if (values.length > 0) {
      const id = Number(values[0].id);
      cache.set(accountNumber, id);
      logger.info(`Resolved account ${accountNumber} → ID ${id}`);
      return id;
    }
  }

  logger.warn(`Could not resolve account number ${accountNumber}`);
  return null;
}

/**
 * Extract amount from various field patterns in the prompt or fields.
 */
function extractAmount(p: ParsedPosting): number {
  return Number(p.amount ?? p.amountGross ?? 0);
}

export async function executeVoucherCreate(
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
): Promise<ExecutorResult> {
  const log = logger.child("executor:voucher");
  const fields = parsed.fields ?? {};

  const steps: ExecutionPlan["steps"] = [];
  const stepResults: StepResult[] = [];
  const accountCache = new Map<number, number>();

  // Extract voucher-level fields
  const date = (fields.date ?? fields.dato ?? new Date().toISOString().slice(0, 10)) as string;
  const description = (fields.description ?? fields.beskrivelse ?? fields.text ?? parsed.normalizedPrompt?.slice(0, 80) ?? "Voucher") as string;

  // Extract postings from LLM output
  const rawPostings = (fields.postings ?? fields.lines ?? fields.posteringer ?? []) as ParsedPosting[];

  // Build normalized posting pairs (debit + credit lines)
  const postingPairs: Array<{ debitAccountNum: number; creditAccountNum: number; amount: number; description?: string }> = [];

  if (rawPostings.length > 0) {
    for (const p of rawPostings) {
      const amount = extractAmount(p);
      if (amount === 0) continue;

      if (p.debitAccount && p.creditAccount) {
        // LLM gave both debit and credit in one posting object
        postingPairs.push({
          debitAccountNum: Number(p.debitAccount),
          creditAccountNum: Number(p.creditAccount),
          amount,
          description: p.description,
        });
      } else if (p.debitAccount || p.creditAccount || p.account) {
        // Single-sided posting — collect and try to pair later
        // For now, treat as debit if positive, credit if negative
        const accountNum = Number(p.debitAccount ?? p.creditAccount ?? p.account);
        if (p.creditAccount) {
          postingPairs.push({
            debitAccountNum: 0, // placeholder, will be filled
            creditAccountNum: accountNum,
            amount: Math.abs(amount),
          });
        } else {
          postingPairs.push({
            debitAccountNum: accountNum,
            creditAccountNum: 0,
            amount: Math.abs(amount),
          });
        }
      }
    }
  }

  // Fallback: try flat fields
  if (postingPairs.length === 0) {
    const debitAccount = Number(fields.debitAccount ?? fields.debitkonto ?? fields.debit ?? 0);
    const creditAccount = Number(fields.creditAccount ?? fields.kreditkonto ?? fields.credit ?? fields.kredit ?? 0);
    const amount = Number(fields.amount ?? fields.beløp ?? fields.sum ?? 0);

    if (debitAccount && creditAccount && amount) {
      postingPairs.push({ debitAccountNum: debitAccount, creditAccountNum: creditAccount, amount });
    }
  }

  // Fallback: try to parse from the normalized prompt
  if (postingPairs.length === 0 && parsed.normalizedPrompt) {
    const promptParsed = parseAccountsFromPrompt(parsed.normalizedPrompt);
    if (promptParsed) {
      postingPairs.push(promptParsed);
    }
  }

  if (postingPairs.length === 0) {
    log.error("No valid postings could be built for voucher");
    return {
      plan: { summary: "Voucher creation failed: no postings", steps: [] },
      stepResults: [{ stepNumber: 0, success: false, statusCode: 0, error: "No valid debit/credit postings found", duration: 0 }],
      verified: false,
    };
  }

  // Resolve all account numbers to Tripletex internal IDs
  const uniqueAccountNums = new Set<number>();
  for (const pair of postingPairs) {
    if (pair.debitAccountNum) uniqueAccountNums.add(pair.debitAccountNum);
    if (pair.creditAccountNum) uniqueAccountNums.add(pair.creditAccountNum);
  }

  let stepNum = 0;
  for (const accNum of uniqueAccountNums) {
    if (accNum === 0) continue;
    stepNum++;
    steps.push({
      stepNumber: stepNum,
      description: `GET /v2/ledger/account — lookup account ${accNum}`,
      method: "GET" as const,
      endpoint: "/v2/ledger/account",
      queryParams: { number: String(accNum) },
      resultKey: `account_${accNum}`,
    });

    const start = Date.now();
    const resolved = await resolveAccountId(accNum, client, log, accountCache);
    stepResults.push({
      stepNumber: stepNum,
      success: resolved !== null,
      statusCode: resolved !== null ? 200 : 404,
      data: resolved !== null ? { accountNumber: accNum, accountId: resolved } : null,
      duration: Date.now() - start,
      ...(!resolved && { error: `Account ${accNum} not found` }),
    });

    if (resolved === null) {
      return {
        plan: { summary: `Account ${accNum} not found in Tripletex`, steps },
        stepResults,
        verified: false,
      };
    }
  }

  // Build Tripletex voucher postings with resolved IDs
  const voucherPostings: Array<Record<string, unknown>> = [];

  for (const pair of postingPairs) {
    if (pair.debitAccountNum && pair.debitAccountNum !== 0) {
      const debitId = accountCache.get(pair.debitAccountNum);
      if (debitId) {
        voucherPostings.push({
          account: { id: debitId },
          amountGross: pair.amount,
          ...(pair.description && { description: pair.description }),
        });
      }
    }
    if (pair.creditAccountNum && pair.creditAccountNum !== 0) {
      const creditId = accountCache.get(pair.creditAccountNum);
      if (creditId) {
        voucherPostings.push({
          account: { id: creditId },
          amountGross: -pair.amount,
          ...(pair.description && { description: pair.description }),
        });
      }
    }
  }

  if (voucherPostings.length === 0) {
    log.error("No postings could be built after account resolution");
    return {
      plan: { summary: "Voucher creation failed: account resolution failed", steps },
      stepResults,
      verified: false,
    };
  }

  const body = {
    date,
    description,
    postings: voucherPostings,
  };

  stepNum++;
  steps.push({
    stepNumber: stepNum,
    description: `POST /v2/ledger/voucher — "${description}"`,
    method: "POST" as const,
    endpoint: "/v2/ledger/voucher",
    body,
    resultKey: "voucherId",
  });

  log.info("Creating voucher", { postingCount: voucherPostings.length, date, description });
  const start = Date.now();
  const res = await client.postWithRetry("/v2/ledger/voucher", body);
  const success = res.status >= 200 && res.status < 300;

  stepResults.push({
    stepNumber: stepNum,
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

/**
 * Try to parse account numbers and amount from a normalized English prompt.
 * Patterns like: "Transfer 5000 from account 1920 to account 7100"
 *                "Book 3000 debit 6300 credit 2400"
 */
function parseAccountsFromPrompt(prompt: string): { debitAccountNum: number; creditAccountNum: number; amount: number } | null {
  // Pattern: "from account X to account Y" with amount
  const fromTo = prompt.match(/(\d[\d\s,.]*(?:kr|NOK)?)\s+(?:from|fra)\s+(?:account|konto)\s+(\d{4})\s+(?:to|til)\s+(?:account|konto)\s+(\d{4})/i);
  if (fromTo) {
    return {
      amount: parseNorwegianNumber(fromTo[1]),
      debitAccountNum: Number(fromTo[3]), // "to" account is debited
      creditAccountNum: Number(fromTo[2]), // "from" account is credited
    };
  }

  // Pattern: "debit X credit Y amount Z" or "debet X kredit Y"
  const debitCredit = prompt.match(/(?:debit|debet)\s+(\d{4}).*?(?:credit|kredit)\s+(\d{4}).*?(\d[\d\s,.]*)/i);
  if (debitCredit) {
    return {
      debitAccountNum: Number(debitCredit[1]),
      creditAccountNum: Number(debitCredit[2]),
      amount: parseNorwegianNumber(debitCredit[3]),
    };
  }

  // Pattern: amount then "account X" and "account Y"
  const twoAccounts = prompt.match(/(\d[\d\s,.]*(?:kr|NOK)?)\b.*?(?:account|konto)\s+(\d{4}).*?(?:account|konto)\s+(\d{4})/i);
  if (twoAccounts) {
    return {
      amount: parseNorwegianNumber(twoAccounts[1]),
      debitAccountNum: Number(twoAccounts[2]),
      creditAccountNum: Number(twoAccounts[3]),
    };
  }

  return null;
}

function parseNorwegianNumber(str: string): number {
  return Number(str.replace(/[^0-9.,]/g, "").replace(/\s/g, "").replace(",", ".")) || 0;
}
