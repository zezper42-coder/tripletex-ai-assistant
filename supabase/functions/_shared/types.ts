// ===== Competition payload =====
export interface SolveRequest {
  task: string;
  tripletexApiUrl: string;
  sessionToken: string;
  mockMode?: boolean;
  attachments?: Attachment[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  url?: string;
  base64?: string;
}

// ===== Agent pipeline =====
export type Language = "nb" | "nn" | "en" | "es" | "pt" | "de" | "fr" | "unknown";

export type Intent =
  | "create"
  | "update"
  | "delete"
  | "list"
  | "get"
  | "link"
  | "reverse"
  | "unknown";

export type ResourceType =
  | "employee"
  | "customer"
  | "product"
  | "invoice"
  | "payment"
  | "creditNote"
  | "project"
  | "travelExpense"
  | "department"
  | "order"
  | "account"
  | "voucher"
  | "contact"
  | "address"
  | "activity"
  | "unknown";

export interface ParsedTask {
  language: Language;
  normalizedPrompt: string;
  intent: Intent;
  resourceType: ResourceType;
  fields: Record<string, unknown>;
  dependencies: Dependency[];
  confidence: number;
  notes: string;
}

export interface Dependency {
  field: string;
  dependsOnStep: number;
  dependsOnField: string;
}

// ===== Execution =====
export interface ExecutionStep {
  stepNumber: number;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpoint: string;
  body?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  dependsOn?: Dependency[];
  resultKey?: string;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  summary: string;
}

export interface StepResult {
  stepNumber: number;
  success: boolean;
  statusCode: number;
  data?: unknown;
  error?: string;
  duration: number;
}

export interface PipelineResult {
  status: "completed" | "failed";
  language: Language;
  parsedTask: ParsedTask | null;
  executionPlan: ExecutionPlan | null;
  stepResults: StepResult[];
  verificationPassed: boolean;
  logs: LogEntry[];
  duration: number;
  error?: string;
}

// ===== Logging =====
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}
