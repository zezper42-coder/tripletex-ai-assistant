

## Add `travel_expense_create` Executor

### What changes

**1. New executor: `supabase/functions/_shared/executors/travel-expense-create-executor.ts`**
- Extract fields: employee reference (id/email/name), travel date, amount, currency, from/to locations, purpose/description
- Normalize field aliases across languages (ansatt/empleado/funcionário, dato/fecha/Datum, beløp/monto/Betrag, etc.)
- Employee resolution: search by email first, then by name via `GET /v2/employee` with narrow filters
- If zero or ambiguous employee matches: fail cleanly with structured error
- Validate: employee reference required, amount numeric and non-negative, date valid if present
- Build minimal valid payload for `POST /v2/travelExpense`
- Verify via `GET /v2/travelExpense/{id}`
- TODO markers for: exact Tripletex travelExpense body fields (e.g. `rateCategoryType`, `perDiemCompensation`), receipt/attachment enrichment

**2. Update `supabase/functions/_shared/task-router.ts`**
- Import `executeTravelExpenseCreate` from new executor
- Add `travel_expense_create` to `EXECUTOR_MAP`
- Remove duplicate TODO comment

**3. Update `supabase/functions/_shared/field-validation.ts`**
- Add `validateTravelExpenseCreateFields(fields)` — requires at least one employee reference, validates amount/date

**4. Update `supabase/functions/_shared/heuristics.ts`**
- No changes needed — `TRAVEL_KEYWORDS` and `CREATE_KEYWORDS` already cover this case

**5. Update `supabase/functions/_shared/mock-data.ts`**
- Add `buildMockTravelExpenseCreate()` with realistic mock pipeline result
- Update `getMockResult` to detect travel expense creation (create keyword + travel keyword, without delete keyword)

**6. Update `src/lib/sample-prompts.ts`**
- Add travel expense creation prompts: Norwegian, English, German, Spanish, one with employee email, one with route info and purpose

### Technical details

- Employee resolution strategy: email → name search → fail. Uses `GET /v2/employee?email={exact}` or `GET /v2/employee?firstName=X&lastName=Y`
- Payload follows pattern: `{ employee: { id }, date, title/description, amount }` — exact fields need live confirmation (TODO markers)
- The executor is ready to consume file-derived data if `parsed.fields` contains attachment-extracted info
- Mock data detection: checks for travel keywords AND create keywords AND NOT delete keywords

### What remains after this iteration
- Live Tripletex travelExpense field confirmation (exact body shape, required vs optional fields)
- Receipt/document attachment extraction enrichment
- Travel expense cost categories and per diem handling
- `travel_expense_update` if needed

