// Task routing — maps parsed task_type to executor functions

import { Logger } from "./logger.ts";
import { TripletexClient } from "./tripletex-client.ts";
import { ParsedTask, StepResult, ExecutionPlan } from "./types.ts";
import { executeCustomerCreate } from "./executors/customer-executor.ts";
import { executeEmployeeCreate } from "./executors/employee-executor.ts";
import { executeProductCreate } from "./executors/product-executor.ts";
import { executeProjectCreate } from "./executors/project-executor.ts";
import { executeTravelExpenseDelete } from "./executors/travel-expense-executor.ts";
import { executeInvoiceCreate } from "./executors/invoice-executor.ts";
import { executePaymentCreate } from "./executors/payment-executor.ts";
import { executeDepartmentCreate } from "./executors/department-executor.ts";

export interface ExecutorResult {
  plan: ExecutionPlan;
  stepResults: StepResult[];
  verified: boolean;
}

export type TaskType =
  | "customer_create"
  | "employee_create"
  | "product_create"
  | "invoice_create"
  | "project_create"
  | "department_create"
  | "travel_expense_create"
  | "travel_expense_delete"
  | "payment_create"
  | "unknown";

type ExecutorFn = (
  parsed: ParsedTask,
  client: TripletexClient,
  logger: Logger
) => Promise<ExecutorResult>;

const EXECUTOR_MAP: Record<string, ExecutorFn> = {
  customer_create: executeCustomerCreate,
  employee_create: executeEmployeeCreate,
  product_create: executeProductCreate,
  project_create: executeProjectCreate,
  travel_expense_delete: executeTravelExpenseDelete,
  invoice_create: executeInvoiceCreate,
  payment_create: executePaymentCreate,
  department_create: executeDepartmentCreate,
  // TODO: travel_expense_create
  // TODO: travel_expense_create
};

export function resolveTaskType(intent: string, resourceType: string): TaskType {
  const key = `${resourceType}_${intent}`;
  if (key in EXECUTOR_MAP) return key as TaskType;
  return "unknown";
}

export function getExecutor(taskType: TaskType): ExecutorFn | null {
  return EXECUTOR_MAP[taskType] ?? null;
}

export function listSupportedTaskTypes(): string[] {
  return Object.keys(EXECUTOR_MAP);
}
