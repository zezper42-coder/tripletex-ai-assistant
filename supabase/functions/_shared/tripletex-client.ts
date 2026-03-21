import { Logger } from "./logger.ts";
import { extractValidationFields, stripFields } from "./field-validation.ts";

const PROTECTED_RETRY_FIELDS = new Set([
  "name",
  "firstName",
  "lastName",
  "customer",
  "customerId",
  "supplier",
  "supplierId",
  "employee",
  "employeeId",
  "invoiceId",
  "invoiceDate",
  "invoiceDueDate",
  "paymentDate",
  "amount",
  "deliveryDate",
  "orderDate",
  "orderLines",
  "lineItems",
  "postings",
  "date",
  "description",
  "title",
]);

function getRetriableFields(responseData: unknown): string[] {
  if (!responseData || typeof responseData !== "object") return [];
  const data = responseData as Record<string, unknown>;
  const messages = data.validationMessages as Array<{ field?: string; message?: string }> | undefined;
  if (!Array.isArray(messages)) return [];

  const removable = new Set<string>();

  for (const message of messages) {
    const field = String(message.field ?? "").trim();
    const text = String(message.message ?? "").toLowerCase();

    if (!field || field === "request body") continue;
    if (
      text.includes("kan ikke være null") ||
      text.includes("cannot be null") ||
      text.includes("must not be null") ||
      text.includes("required") ||
      text.includes("må være")
    ) {
      continue;
    }

    const topLevelField = field
      .replace(/^null\./, "")
      .replace(/^[^.]+\./, "")
      .split(".")[0]
      .replace(/\[\d+\]/g, "");

    if (!topLevelField || PROTECTED_RETRY_FIELDS.has(topLevelField)) continue;
    removable.add(topLevelField);
  }

  return Array.from(removable);
}

export interface TripletexConfig {
  baseUrl: string;
  sessionToken: string;
}

export class TripletexClient {
  private baseUrl: string;
  private authHeader: string;
  private logger: Logger;

  constructor(config: TripletexConfig, logger: Logger) {
    // Strip trailing slash and /v2 suffix to avoid double-prefixing (endpoints already include /v2)
    this.baseUrl = config.baseUrl.replace(/\/$/, "").replace(/\/v2$/, "");
    this.authHeader = "Basic " + btoa(`0:${config.sessionToken}`);
    this.logger = logger;
  }

  async request(
    method: string,
    endpoint: string,
    options?: {
      body?: unknown;
      queryParams?: Record<string, string>;
      retries?: number;
    }
  ): Promise<{ status: number; data: unknown }> {
    const retries = options?.retries ?? 0;
    let url = `${this.baseUrl}${endpoint}`;

    if (options?.queryParams) {
      const params = new URLSearchParams(options.queryParams);
      url += `?${params.toString()}`;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.logger.info(`${method} ${endpoint}`, { attempt, hasBody: !!options?.body });

        const fetchOptions: RequestInit = {
          method,
          headers: {
            "Authorization": this.authHeader,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
        };

        if (options?.body && (method === "POST" || method === "PUT")) {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const start = Date.now();
        const response = await fetch(url, fetchOptions);
        const duration = Date.now() - start;

        let data: unknown = null;
        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }

        this.logger.info(`Response ${response.status} in ${duration}ms`, {
          endpoint,
          status: response.status,
          duration,
        });

        // Extract Tripletex error details for 4xx/5xx responses
        if (response.status >= 400 && data && typeof data === "object") {
          const errObj = data as Record<string, unknown>;
          const errDetails: Record<string, unknown> = {};
          if (errObj.message) errDetails.message = errObj.message;
          if (errObj.developerMessage) errDetails.developerMessage = errObj.developerMessage;
          if (errObj.validationMessages) errDetails.validationMessages = errObj.validationMessages;
          if (errObj.code) errDetails.code = errObj.code;
          if (Object.keys(errDetails).length > 0) {
            this.logger.warn(`Tripletex error details`, { endpoint, ...errDetails });
          }
        }

        if (response.status >= 500 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 500;
          this.logger.warn(`Retrying in ${delay}ms (attempt ${attempt + 1})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        return { status: response.status, data };
      } catch (err) {
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 500;
          this.logger.warn(`Network error, retrying in ${delay}ms`, { error: String(err) });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Request failed after ${retries + 1} attempts`);
  }

  get(endpoint: string, queryParams?: Record<string, string>) {
    return this.request("GET", endpoint, { queryParams });
  }

  post(endpoint: string, body: unknown) {
    return this.request("POST", endpoint, { body });
  }

  /**
   * POST with automatic 422 retry: strips invalid fields and retries once.
   */
  async postWithRetry(endpoint: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
    const res = await this.post(endpoint, body);
    if (res.status === 422) {
      const badFields = getRetriableFields(res.data).filter((field) => field in body);
      if (badFields.length > 0) {
        this.logger.warn(`422 retry: stripping fields [${badFields.join(", ")}]`);
        const cleaned = stripFields(body, badFields);
        if (JSON.stringify(cleaned) !== JSON.stringify(body)) {
          return this.post(endpoint, cleaned);
        }
      }
    }
    return res;
  }

  /**
   * PUT with automatic 422 retry: strips invalid fields and retries once.
   */
  async putWithRetry(endpoint: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
    const res = await this.put(endpoint, body);
    if (res.status === 422) {
      const badFields = getRetriableFields(res.data).filter((field) => field in body);
      if (badFields.length > 0) {
        this.logger.warn(`422 retry (PUT): stripping fields [${badFields.join(", ")}]`);
        const cleaned = stripFields(body, badFields);
        if (JSON.stringify(cleaned) !== JSON.stringify(body)) {
          return this.put(endpoint, cleaned);
        }
      }
    }
    return res;
  }

  put(endpoint: string, body: unknown) {
    return this.request("PUT", endpoint, { body });
  }

  delete(endpoint: string) {
    return this.request("DELETE", endpoint);
  }
}
