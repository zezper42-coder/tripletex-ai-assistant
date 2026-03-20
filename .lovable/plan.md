

## Fix Critical Bugs and Harden Against Tripletex API Docs

The Tripletex API docs confirm response envelopes, auth, date formats, and endpoint patterns. Reviewing the codebase against these docs reveals one critical bug and several hardening opportunities.

### Critical bug: `searchRes.ok` does not exist

In `credit-note-executor.ts`, the code uses `searchRes.ok` (lines 50, 56, 72) but `TripletexClient.request()` returns `{ status: number; data: unknown }` — there is no `.ok` property. This means `searchRes.ok` is always `undefined` (falsy), so **every invoice lookup by number or customer name silently fails**, making credit notes broken for all non-direct-ID cases.

### Changes

**1. Fix `credit-note-executor.ts` — replace `searchRes.ok` with status checks**
- Replace `searchRes.ok` with `searchRes.status >= 200 && searchRes.status < 300` (3 occurrences)
- Fix response envelope parsing: use `(searchRes.data as any)?.values` pattern consistently matching Tripletex `{ values: [...] }` envelope
- Fix operator precedence bug on line 53: `searchRes.data?.values ?? searchRes.data?.value ? [...]` — the ternary binds wrong

**2. Add `fields` query parameter to key GET requests**
Per API docs, Tripletex requires explicit `fields` param to get full objects. Without it, responses may return only `{ id, url }`. Add `fields=*` to:
- Invoice search in credit-note-executor and payment-executor
- Employee search in travel-expense-create-executor
- Customer search in invoice-executor

**3. Add `version` field awareness for PUT operations**
API docs state PUT requires a `version` field to prevent edit conflicts. The invoice and credit note executors use PUT (e.g., `PUT /v2/order/{id}/:invoice`). These action endpoints may not need version, but add a TODO note for live confirmation.

**4. Handle Tripletex error envelope in client**
When status >= 400, Tripletex returns `{ status, code, message, developerMessage, validationMessages }`. Extract and log `message` + `validationMessages` for better debug output.

### Files to edit
- `supabase/functions/_shared/executors/credit-note-executor.ts` — fix `.ok` bug, fix envelope parsing
- `supabase/functions/_shared/tripletex-client.ts` — extract error details from 4xx responses
- `supabase/functions/_shared/executors/payment-executor.ts` — add `fields=*` to invoice search
- `supabase/functions/_shared/executors/invoice-executor.ts` — add `fields=*` to customer search
- `supabase/functions/_shared/executors/travel-expense-create-executor.ts` — add `fields=*` to employee search

### What this fixes
- Credit note executor now actually works for invoice-number and customer-name lookups
- Better error diagnostics from Tripletex 4xx responses
- Correct response data extraction across all executors

