## Implemented Changes (Round 3)

### Done
1. **Removed verification in LLM fallback pipeline** — `agent-pipeline.ts` no longer calls `verifyExecution()`. Saves 1-3 API calls per task.

2. **Optimized employee executor** — Removed fallback department lookup (was always fetching dept even when not specified). Now only searches if department is explicitly mentioned. Saves 1 API call.

3. **Added supplier/contact heuristics** — `heuristics.ts` now includes `SUPPLIER_KEYWORDS` and `CONTACT_KEYWORDS` for correct routing.

4. **Switched planner model** — `task-planner.ts` now uses `google/gemini-2.5-flash` instead of `openai/gpt-5`. Faster and cheaper.

5. **Added 422 auto-retry** — `TripletexClient.postWithRetry()` parses `validationMessages`, strips bad fields, retries once. `extractValidationFields()` and `stripFields()` helpers added to `field-validation.ts`.

6. **Added voucher executor** — New `voucher_create` executor for Tier 3 ledger tasks. POST `/v2/ledger/voucher` with debit/credit postings.

7. **Improved attachment OCR prompt** — More specific structured JSON extraction prompt for invoices, travel expenses, etc.

### Total executor count: 15
- customer_create, customer_update
- employee_create, employee_update
- product_create, department_create, project_create
- invoice_create, payment_create, creditNote_create
- travel_expense_create, travel_expense_delete
- supplier_create, contact_create
- voucher_create (NEW)

### API call savings per task
- Removed verification: -1 to -3 calls
- Employee no-dept: -1 call
- Total: 2-4 fewer calls per task → better efficiency bonus

### Still needed
- Use `postWithRetry` in more executors (currently available, not yet wired in all)
- Live test voucher executor
- `travel_expense_update` executor
