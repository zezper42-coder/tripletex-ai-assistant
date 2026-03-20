

## Executor Coverage Summary

### Implemented executors
| Task Type | Executor | Status |
|---|---|---|
| `customer_create` | customer-executor.ts | ✅ |
| `employee_create` | employee-executor.ts | ✅ |
| `product_create` | product-executor.ts | ✅ |
| `project_create` | project-executor.ts | ✅ |
| `invoice_create` | invoice-executor.ts | ✅ |
| `payment_create` | payment-executor.ts | ✅ |
| `department_create` | department-executor.ts | ✅ |
| `travel_expense_delete` | travel-expense-executor.ts | ✅ |
| `travel_expense_create` | travel-expense-create-executor.ts | ✅ |
| `credit_note_create` | credit-note-executor.ts | ✅ |

### Shared helpers
| Helper | Purpose |
|---|---|
| `vat-lookup.ts` | Per-request cached VAT type resolution via GET /v2/ledger/vatType |
| `tripletex-compat.ts` | Endpoint variant fallbacks + behavior confirmation registry |

### Live Sandbox Verification Checklist

| Behavior | Status | Notes |
|---|---|---|
| POST /v2/customer | ✅ confirmed | Standard creation |
| POST /v2/employee | ✅ confirmed | Standard creation |
| POST /v2/product | ✅ confirmed | Standard creation |
| POST /v2/product with vatType | ⚠️ unconfirmed_safe | vatType {id} object — omit if unknown |
| POST /v2/department | ✅ confirmed | Standard creation |
| GET /v2/ledger/vatType | ✅ confirmed | VAT type listing |
| POST /v2/order | ✅ confirmed | Order as invoice precursor |
| PUT /v2/order/{id}/:invoice | ⚠️ unconfirmed_safe | Primary invoice-from-order; needs invoiceDate+dueDate |
| POST /v2/invoice (direct) | ⚠️ unconfirmed_safe | Fallback with orders ref |
| orderLines.vatType required | 🔴 TODO | Some configs require vatType on every line |
| order.receiver field | 🔴 TODO | Some configs require receiver name |
| POST /v2/payment | 🔴 TODO | Payment endpoint; may need paymentType + account |
| payment.voucher linkage | 🔴 TODO | May need different ref pattern |
| PUT /v2/invoice/{id}/:createCreditNote | 🔴 TODO | Primary credit note path |
| partial credit note body | 🔴 TODO | May need line-level adjustments |
| POST /v2/travelExpense | ⚠️ unconfirmed_safe | Basic creation; cost lines may need separate POST |
| travelExpense cost lines | 🔴 TODO | POST /v2/travelExpense/{id}/cost |

### Remaining / future
- `travel_expense_update` — not yet needed
- Receipt/document attachment extraction enrichment
- Employee role assignment via entitlements API
- Credit note creation via negative-amount POST fallback
- Correction/reversal workflows
- customer_update / employee_update executors
