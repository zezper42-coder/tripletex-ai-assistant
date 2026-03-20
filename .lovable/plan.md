

## Add Product, Project, and Travel Expense Delete Executors

### What changes

**1. New executor: `supabase/functions/_shared/executors/product-executor.ts`**
- Extract fields: name, number/code, price (priceExcludingVatCurrency), vatType, description
- Normalize field aliases across languages
- Validate: `name` required
- POST `/v2/product` with minimal valid body
- Verify via GET `/v2/product/{id}`
- TODO markers for VAT type lookup (may need GET `/v2/ledger/vatType` first)

**2. New executor: `supabase/functions/_shared/executors/project-executor.ts`**
- Extract fields: name, projectNumber, description, customer reference
- Validate: `name` required
- If customer name referenced: search via GET `/v2/customer?name={exact}` with minimal scope
- If customer found: link via `customer.id` in project body
- If customer not found and prompt clearly requires linking: fail cleanly with structured reason
- POST `/v2/project` 
- Verify via GET `/v2/project/{id}`
- TODO: confirm exact Tripletex project body fields (`projectManagerId` may be required — need fallback)

**3. New executor: `supabase/functions/_shared/executors/travel-expense-executor.ts`**
- Handles `travel_expense_delete` task type
- Extract identifiers: id, employee name, date, amount, description
- Search strategy: GET `/v2/travelExpense` with narrowest possible filters (employee name, date range)
- If exactly one result: DELETE `/v2/travelExpense/{id}`
- If zero or multiple results: fail cleanly with structured ambiguity info
- No broad deletions ever

**4. Update `supabase/functions/_shared/task-router.ts`**
- Import new executors
- Add `product_create`, `project_create`, `travel_expense_delete` to EXECUTOR_MAP

**5. Update `supabase/functions/_shared/heuristics.ts`**
- Already has PRODUCT_KEYWORDS, PROJECT_KEYWORDS, TRAVEL_KEYWORDS — no changes needed (already wired)

**6. Update `supabase/functions/_shared/field-validation.ts`**
- Add `validateProductFields(fields)` — requires `name`
- Add `validateProjectFields(fields)` — requires `name`
- Add `validateTravelExpenseDeleteFields(fields)` — requires at least one identifier

**7. Update `src/lib/sample-prompts.ts`**
- Add Norwegian product creation, English project creation with customer, German product creation, Spanish travel expense deletion, Portuguese project creation, French travel expense deletion

**8. Update `supabase/functions/_shared/mock-data.ts`**
- Add mock results for product_create, project_create, travel_expense_delete

### Technical details

- All executors follow the same pattern as customer-executor: normalize fields → validate → build body → execute → verify → return ExecutorResult
- The travel expense delete executor uses a search-then-delete pattern with strict uniqueness check
- Project executor conditionally searches for customer only when the prompt references one
- Debug output already works via `x-debug: true` header — new executors automatically included in pipeline response

### What remains after this iteration
- `invoice_create` (complex: requires customer + product references, line items)
- `department_create` (simpler but lower priority)
- `payment_create` (requires invoice reference)
- `travel_expense_create` (needs employee lookup + date/amount)
- Employee role assignment via entitlements API
- VAT type lookup for products

