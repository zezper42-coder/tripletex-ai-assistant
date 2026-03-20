## Implemented Changes (Round 4 — OpenAPI Spec Integration)

### Done
1. **Fixed supplier endpoint** — `supplier-executor.ts` now POSTs to `/v2/customer` with `isSupplier: true` instead of non-existent `/v2/supplier`.

2. **Wired `postWithRetry` into ALL executors** — Every executor now uses `client.postWithRetry()` for automatic 422 recovery (strip invalid fields + retry once):
   - customer, employee, product, department, supplier, contact, voucher, project, invoice (customer + order), travel expense, payment

3. **Removed travel expense cost line** — Removed the unverified `/v2/travelExpense/cost` POST that likely caused 404 errors.

4. **Enhanced LLM parser prompt** — Added full Tripletex API schema requirements (required/optional fields per resource type) to reduce LLM misclassification.

5. **Added voucher + order heuristic keywords** — `heuristics.ts` now routes "bilag", "bestilling", "ordre" etc. correctly.

### Total executor count: 15 (unchanged)
### API call savings per task: 1-3 fewer (no verification + no cost line + postWithRetry avoids manual retry logic)

### Submit URL
`https://lbhntwxejshppcasdmxh.supabase.co/functions/v1/solve`
