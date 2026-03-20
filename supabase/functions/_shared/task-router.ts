// Task routing — maps parsed task_type to executor functions

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "./types.ts";
import { executeCustomerCreate } from "./executors/customer-executor.ts";
import { executeCustomerUpdate } from "./executors/customer-update-executor.ts";
import { executeEmployeeCreate } from "./executors/employee-executor.ts";
import { executeEmployeeUpdate } from "./executors/employee-update-executor.ts";
import { executeProductCreate } from "./executors/product-executor.ts";
import { executeProjectCreate } from "./executors/project-executor.ts";
import { executeTravelExpenseDelete } from "./executors/travel-expense-executor.ts";
import { executeTravelExpenseCreate } from "./executors/travel-expense-create-executor.ts";
import { executeInvoiceCreate } from "./executors/invoice-executor.ts";
import { executePaymentCreate } from "./executors/payment-executor.ts";
import { executeDepartmentCreate } from "./executors/department-executor.ts";
import { executeCreditNoteCreate } from "./executors/credit-note-executor.ts";
import { executeSupplierCreate } from "./executors/supplier-executor.ts";
import { executeContactCreate } from "./executors/contact-executor.ts";
import { executeVoucherCreate } from "./executors/voucher-executor.ts";

export interface ExecutorResult {
  plan: ExecutionPlan;
  stepResults: StepResult[];
  verified: boolean;
}

export type TaskType =
  | "customer_create"
  | "customer_update"
  | "employee_create"
  | "employee_update"
  | "product_create"
  | "product_update"
  | "invoice_create"
  | "project_create"
  | "department_create"
  | "travel_expense_create"
  | "travel_expense_delete"
  | "travel_expense_update"
  | "payment_create"
  | "creditNote_create"
  | "supplier_create"
  | "supplier_update"
  | "contact_create"
  | "voucher_create"
  | "unknown";

type ExecutorFn = (
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
) => Promise<ExecutorResult>;

const EXECUTOR_MAP: Record<string, ExecutorFn> = {
  customer_create: executeCustomerCreate,
  customer_update: executeCustomerUpdate,
  employee_create: executeEmployeeCreate,
  employee_update: executeEmployeeUpdate,
  product_create: executeProductCreate,
  // product_update and supplier_update fall to swarm (different endpoint patterns)
  project_create: executeProjectCreate,
  travel_expense_delete: executeTravelExpenseDelete,
  travel_expense_create: executeTravelExpenseCreate,
  invoice_create: executeInvoiceCreate,
  payment_create: executePaymentCreate,
  department_create: executeDepartmentCreate,
  creditNote_create: executeCreditNoteCreate,
  supplier_create: executeSupplierCreate,
  // supplier_update falls to swarm
  contact_create: executeContactCreate,
  voucher_create: executeVoucherCreate,
};

// Normalize camelCase resource types to snake_case for executor lookup
const RESOURCE_ALIASES: Record<string, string> = {
  travelExpense: "travel_expense",
  creditNote: "creditNote", // already matches
  travelexpense: "travel_expense",
  creditnote: "creditNote",
};

export function resolveTaskType(intent: string, resourceType: string): TaskType {
  const normalizedResource = RESOURCE_ALIASES[resourceType] ?? resourceType;
  const key = `${normalizedResource}_${intent}`;
  if (key in EXECUTOR_MAP) return key as TaskType;
  return "unknown";
}

export function getExecutor(taskType: TaskType): ExecutorFn | null {
  return EXECUTOR_MAP[taskType] ?? null;
}

export function listSupportedTaskTypes(): string[] {
  return Object.keys(EXECUTOR_MAP);
}
