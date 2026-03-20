

## Add `credit_note_create` Executor

### What changes

**1. New executor: `supabase/functions/_shared/executors/credit-note-executor.ts`**
- Follow the same pattern as invoice/payment executors
- Invoice resolution: use `invoiceId` → `invoiceNumber` → customer name search (narrow, fail on ambiguity)
- Credit note creation via `PUT /v2/invoice/{id}/:createCreditNote` (Tripletex's action endpoint on invoice)
- Fallback: `POST /v2/invoice` with negative amounts if the action endpoint fails
- Full vs partial credit: default to full; partial only if explicit amount differs from invoice total
- TODO markers for exact Tripletex credit note endpoint confirmation
- Verify via response data

**2. Update `supabase/functions/_shared/heuristics.ts`**
- Add `CREDIT_NOTE_KEYWORDS`: "credit note", "kreditnota", "kreditering", "Gutschrift", "nota de crédito", "note de crédit", "nota di credito", "credit", "krediter", "reverse", "correction"
- Add detection block before invoice keywords (credit note is more specific than invoice)
- Map to `likelyResource = "creditNote"`

**3. Update `supabase/functions/_shared/task-router.ts`**
- Add `credit_note_create` to `TaskType` union
- Import and register `executeCreditNoteCreate` in `EXECUTOR_MAP`

**4. Update `supabase/functions/_shared/field-validation.ts`**
- Add `validateCreditNoteFields(fields)` — requires at least one invoice reference

**5. Update `src/lib/sample-prompts.ts`**
- Norwegian full credit note, English credit existing invoice, German by invoice number, Spanish invoice correction, Portuguese credit, French credit note

**6. Update `supabase/functions/_shared/mock-data.ts`**
- Add `buildMockCreditNote()` with invoice search → credit note creation steps
- Wire into `getMockResult` with credit note keyword detection

### Executor logic detail

```text
1. Validate: at least one invoice ref required
2. Resolve invoice (same pattern as payment-executor):
   - invoiceId → direct use
   - invoiceNumber → GET /v2/invoice?invoiceNumber=X
   - customerName → GET /v2/invoice?customerName=X
   - Fail on 0 or >1 matches
3. Determine full vs partial:
   - If no amount specified or amount == invoice total → full
   - If explicit amount < invoice total → partial (TODO: confirm partial credit path)
4. Create credit note:
   - PUT /v2/invoice/{id}/:createCreditNote (primary path)
   - If fails, try POST /v2/invoice with negative lines referencing original (fallback)
5. Return result with credit note ID
```

### What remains after
- `travel_expense_update`
- Live confirmation of exact Tripletex credit note endpoint
- Partial credit note field confirmation

