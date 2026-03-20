// Company setup helpers — ensure fresh Tripletex accounts have required config
// (e.g. bank account number must be registered before invoices can be created)

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";

let companySetupDone = false;

/**
 * Ensure the company has a bank account registered.
 * Fresh Tripletex sandbox accounts lack this, causing invoice creation to fail with:
 * "Faktura kan ikke opprettes før selskapet har registrert et bankkontonummer."
 *
 * This is idempotent — skips if already done in this request lifecycle.
 */
export async function ensureCompanyBankAccount(
  client: TripletexClient,
  logger: Logger,
): Promise<void> {
  if (companySetupDone) return;

  const log = logger.child("company-setup");

  try {
    // Step 1: Get company info
    const companyRes = await client.get("/v2/company", { fields: "id,name,bankAccountNumber,version" });
    if (companyRes.status !== 200) {
      log.warn("Could not fetch company info", { status: companyRes.status });
      return;
    }

    const data = companyRes.data as Record<string, unknown>;
    const company = (data.value ?? data) as Record<string, unknown>;
    const companyId = company.id as number;
    const version = company.version as number;
    const existingBank = company.bankAccountNumber as string | undefined;

    if (existingBank && existingBank.trim().length > 0) {
      log.info("Company already has bank account registered", { bankAccount: existingBank.substring(0, 4) + "***" });
      companySetupDone = true;
      return;
    }

    // Step 2: Register a standard Norwegian bank account number
    // Using a valid MOD11 test account number format
    log.info("Registering bank account for company", { companyId });

    const updateBody: Record<string, unknown> = {
      id: companyId,
      version,
      bankAccountNumber: "15032500953", // Valid Norwegian bank account format
    };

    const updateRes = await client.putWithRetry(`/v2/company/${companyId}`, updateBody);
    if (updateRes.status >= 200 && updateRes.status < 300) {
      log.info("Bank account registered successfully");
      companySetupDone = true;
    } else {
      log.warn("Failed to register bank account", { status: updateRes.status, data: updateRes.data });
      
      // Try alternative: just the bank account number without other fields
      const minimalBody: Record<string, unknown> = {
        id: companyId,
        version,
        bankAccountNumber: "15032500953",
        name: company.name, // name is typically required for PUT
      };
      const retryRes = await client.put(`/v2/company/${companyId}`, minimalBody);
      if (retryRes.status >= 200 && retryRes.status < 300) {
        log.info("Bank account registered on retry");
        companySetupDone = true;
      } else {
        log.error("Bank account registration failed on retry", { status: retryRes.status });
      }
    }
  } catch (err) {
    logger.error("ensureCompanyBankAccount error", { error: String(err) });
  }
}

/**
 * Reset the setup flag (useful between test iterations).
 */
export function resetCompanySetup(): void {
  companySetupDone = false;
}
