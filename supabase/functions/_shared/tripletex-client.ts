import { Logger } from "./logger.ts";

export interface TripletexConfig {
  baseUrl: string;
  sessionToken: string;
}

export class TripletexClient {
  private baseUrl: string;
  private authHeader: string;
  private logger: Logger;

  constructor(config: TripletexConfig, logger: Logger) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
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
    const retries = options?.retries ?? 2;
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

  put(endpoint: string, body: unknown) {
    return this.request("PUT", endpoint, { body });
  }

  delete(endpoint: string) {
    return this.request("DELETE", endpoint);
  }
}
