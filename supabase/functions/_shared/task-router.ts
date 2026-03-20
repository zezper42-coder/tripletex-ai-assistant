// Task routing — maps parsed task_type to executor functions

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "./types.ts";

// ── Executor imports ───────────────────────────────────────────────────
// Create
import { executeCustomerCreate } from "./executors/customer-executor.ts";
import { executeEmployeeCreate } from "./executors/employee-executor.ts";
import { executeProductCreate } from "./executors/product-executor.ts";
import { executeProjectCreate } from "./executors/project-executor.ts";
import { executeInvoiceCreate } from "./executors/invoice-executor.ts";
import { executePaymentCreate } from "./executors/payment-executor.ts";
import { executeDepartmentCreate } from "./executors/department-executor.ts";
import { executeCreditNoteCreate } from "./executors/credit-note-executor.ts";
import { executeSupplierCreate } from "./executors/supplier-executor.ts";
import { executeContactCreate } from "./executors/contact-executor.ts";
import { executeVoucherCreate } from "./executors/voucher-executor.ts";
import { executeTravelExpenseCreate } from "./executors/travel-expense-create-executor.ts";

// Update
import { executeCustomerUpdate } from "./executors/customer-update-executor.ts";
import { executeEmployeeUpdate } from "./executors/employee-update-executor.ts";
import { executeProductUpdate } from "./executors/product-update-executor.ts";
import { executeProjectUpdate } from "./executors/project-update-executor.ts";
import { executeSupplierUpdate } from "./executors/supplier-update-executor.ts";
import { executeDepartmentUpdate } from "./executors/department-update-executor.ts";
import { executeTravelExpenseUpdate } from "./executors/travel-expense-update-executor.ts";
import { executeContactUpdate } from "./executors/contact-update-executor.ts";
import { executeInvoiceUpdate } from "./executors/invoice-update-executor.ts";
import { executeCreditNoteUpdate } from "./executors/credit-note-update-executor.ts";

// Delete
import { executeEmployeeDelete } from "./executors/employee-delete-executor.ts";
import { executeCustomerDelete } from "./executors/customer-delete-executor.ts";
import { executeSupplierDelete } from "./executors/supplier-delete-executor.ts";
import { executeProductDelete } from "./executors/product-delete-executor.ts";
import { executeProjectDelete } from "./executors/project-delete-executor.ts";
import { executeDepartmentDelete } from "./executors/department-delete-executor.ts";
import { executeTravelExpenseDelete } from "./executors/travel-expense-executor.ts";
import { executePaymentDelete } from "./executors/payment-delete-executor.ts";
import { executeVoucherDelete } from "./executors/voucher-delete-executor.ts";
import { executeContactDelete } from "./executors/contact-delete-executor.ts";

export interface ExecutorResult {
  plan: ExecutionPlan;
  stepResults: StepResult[];
  verified: boolean;
}

export type TaskType = string; // Flexible — any {resource}_{intent} combo

type ExecutorFn = (
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
) => Promise<ExecutorResult>;

const EXECUTOR_MAP: Record<string, ExecutorFn> = {
  // ── Create ──
  customer_create: executeCustomerCreate,
  employee_create: executeEmployeeCreate,
  product_create: executeProductCreate,
  project_create: executeProjectCreate,
  invoice_create: executeInvoiceCreate,
  payment_create: executePaymentCreate,
  department_create: executeDepartmentCreate,
  creditNote_create: executeCreditNoteCreate,
  supplier_create: executeSupplierCreate,
  contact_create: executeContactCreate,
  voucher_create: executeVoucherCreate,
  travel_expense_create: executeTravelExpenseCreate,

  // ── Update ──
  customer_update: executeCustomerUpdate,
  employee_update: executeEmployeeUpdate,
  product_update: executeProductUpdate,
  project_update: executeProjectUpdate,
  supplier_update: executeSupplierUpdate,
  department_update: executeDepartmentUpdate,
  travel_expense_update: executeTravelExpenseUpdate,
  contact_update: executeContactUpdate,
  invoice_update: executeInvoiceUpdate,
  creditNote_update: executeCreditNoteUpdate,

  // ── Delete ──
  employee_delete: executeEmployeeDelete,
  customer_delete: executeCustomerDelete,
  supplier_delete: executeSupplierDelete,
  product_delete: executeProductDelete,
  project_delete: executeProjectDelete,
  department_delete: executeDepartmentDelete,
  travel_expense_delete: executeTravelExpenseDelete,
  payment_delete: executePaymentDelete,
  voucher_delete: executeVoucherDelete,
  contact_delete: executeContactDelete,
};

// Normalize camelCase resource types to snake_case for executor lookup
const RESOURCE_ALIASES: Record<string, string> = {
  travelExpense: "travel_expense",
  creditNote: "creditNote",
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
