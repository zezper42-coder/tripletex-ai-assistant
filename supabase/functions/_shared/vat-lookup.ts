// VAT type lookup helper — per-request cache, lazy fetch
// Uses GET /v2/ledger/vatType to resolve valid VAT type IDs

import { TripletexClient } from "./tripletex-client.ts";
import { Logger } from "./logger.ts";

export interface VatType {
  id: number;
  number: number;
  name: string;
  percentage: number;
}

export class VatTypeLookup {
  private cache: VatType[] | null = null;
  private client: TripletexClient;
  private logger: Logger;

  constructor(client: TripletexClient, logger: Logger) {
    this.client = client;
    this.logger = logger.child("vat-lookup");
  }

  /** Fetch all VAT types (cached per instance / per request) */
  async fetchAll(): Promise<VatType[]> {
    if (this.cache) return this.cache;

    this.logger.info("Fetching VAT types from /v2/ledger/vatType");
    const res = await this.client.get("/v2/ledger/vatType");

    if (res.status !== 200 || !res.data) {
      this.logger.warn("VAT type fetch failed", { status: res.status });
      return [];
    }

    const data = res.data as Record<string, unknown>;
    const values = (data.values ?? []) as Record<string, unknown>[];

    this.cache = values.map((v) => ({
      id: Number(v.id),
      number: Number(v.number ?? v.vatNumber ?? 0),
      name: String(v.name ?? ""),
      percentage: Number(v.percentage ?? v.rate ?? 0),
    }));

    this.logger.info(`Cached ${this.cache.length} VAT types`);
    return this.cache;
  }

  /** Resolve a VAT type by rate (e.g. 25), code/number, or partial name */
  async resolve(hint: {
    rate?: number;
    code?: number;
    name?: string;
  }): Promise<VatType | null> {
    const types = await this.fetchAll();
    if (types.length === 0) return null;

    // Exact code/number match first
    if (hint.code != null) {
      const match = types.find((t) => t.number === hint.code);
      if (match) {
        this.logger.info("VAT resolved by code", { code: hint.code, id: match.id });
        return match;
      }
    }

    // Rate match (e.g. 25% → standard MVA)
    if (hint.rate != null) {
      const matches = types.filter((t) => Math.abs(t.percentage - hint.rate!) < 0.01);
      if (matches.length === 1) {
        this.logger.info("VAT resolved by rate", { rate: hint.rate, id: matches[0].id });
        return matches[0];
      }
      // If multiple matches at same rate, prefer output VAT (utgående)
      if (matches.length > 1) {
        const output = matches.find((t) =>
          t.name.toLowerCase().includes("utgående") ||
          t.name.toLowerCase().includes("output") ||
          t.name.toLowerCase().includes("sales")
        );
        if (output) {
          this.logger.info("VAT resolved by rate + output filter", { rate: hint.rate, id: output.id });
          return output;
        }
        // Return first match as fallback
        this.logger.info("VAT resolved by rate (first match)", { rate: hint.rate, id: matches[0].id, candidates: matches.length });
        return matches[0];
      }
    }

    // Partial name match
    if (hint.name) {
      const lower = hint.name.toLowerCase();
      const match = types.find((t) => t.name.toLowerCase().includes(lower));
      if (match) {
        this.logger.info("VAT resolved by name", { name: hint.name, id: match.id });
        return match;
      }
    }

    this.logger.warn("VAT type not resolved", { hint });
    return null;
  }

  /** Get common Norwegian standard VAT (25%) — convenience method */
  async getStandardVat(): Promise<VatType | null> {
    return this.resolve({ rate: 25 });
  }

  /** Debug info: return all cached types for x-debug output */
  getCachedTypes(): VatType[] | null {
    return this.cache;
  }
}
