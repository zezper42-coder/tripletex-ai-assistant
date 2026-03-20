## Implemented Changes (Round 2)

### Done
1. **Removed all verification GET calls** from 7 executors (customer, employee, product, department, project, travel-expense-create, travel-expense-delete). Each saves 1 API call per task → better efficiency bonus.

2. **Switched attachment-handler model** from `openai/gpt-5` to `google/gemini-2.5-flash` with more specific extraction prompt.

3. **Added 4 new executors:**
   - `supplier_create` — POST /v2/supplier (isSupplier=true)
   - `contact_create` — POST /v2/contact with optional customer linking
   - `customer_update` — GET + merge + PUT with version field
   - `employee_update` — GET + merge + PUT with version field

4. **Updated task-router** to register all 14 executors.

5. **Updated types.ts** to include `supplier` as ResourceType.

6. **Updated task-parser** prompt to include `supplier` in resource type enum.

### Total executor count: 14
- customer_create, customer_update
- employee_create, employee_update
- product_create, department_create, project_create
- invoice_create, payment_create, creditNote_create
- travel_expense_create, travel_expense_delete
- supplier_create, contact_create

### Still needed for higher scores
- Live testing against competition proxy (need proxy base_url)
- `travel_expense_update` executor
- Ledger/voucher executors (Tier 3)
- Auto-retry on 422 with field stripping
