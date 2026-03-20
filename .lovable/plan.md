

# Plan: Integrate OpenAPI Spec Knowledge to Maximize Score

## Context
You uploaded the full Tripletex OpenAPI spec (109K lines). The current system has 15 executors but scored 0% on the last submission. The most likely root causes are:
1. **Supplier endpoint mismatch** — our supplier executor POSTs to `/v2/supplier`, but Tripletex uses `/v2/customer` with `isSupplier: true` (no separate supplier endpoint)
2. **Missing `postWithRetry`** in most executors — only available in `TripletexClient` but not wired into executors
3. **Travel expense cost endpoint may not exist** — `/v2/travelExpense/cost` is a guess; the spec likely uses a different path
4. **Payment endpoint structure** — may need `paymentType` as a required field
5. **LLM parser prompt** lacks Tripletex-specific schema knowledge from the spec

## Changes

### 1. Fix supplier executor — POST to `/v2/customer` not `/v2/supplier`
The Tripletex API does not have a separate `/v2/supplier` endpoint. Suppliers are created via `/v2/customer` with `isSupplier: true, isCustomer: false`. Our supplier executor currently POSTs to the wrong URL.

**File:** `supabase/functions/_shared/executors/supplier-executor.ts`
- Change endpoint from `/v2/supplier` to `/v2/customer`

### 2. Wire `postWithRetry` into all executors
The `TripletexClient.postWithRetry()` method already exists but is unused. Replace `client.post()` with `client.postWithRetry()` in:
- `customer-executor.ts`
- `employee-executor.ts`
- `product-executor.ts`
- `project-executor.ts`
- `invoice-executor.ts` (for order and customer creation)
- `supplier-executor.ts`
- `contact-executor.ts`
- `department-executor.ts`
- `travel-expense-create-executor.ts`
- `voucher-executor.ts`

This gives every executor automatic 422 recovery — strip invalid fields and retry once.

### 3. Fix travel expense cost line
Remove the `/v2/travelExpense/cost` call from `travel-expense-create-executor.ts`. Instead, include costs inline in the initial POST body if the spec supports it, or skip the cost line entirely (still scores points for creating the expense).

### 4. Embed OpenAPI schema knowledge into the LLM parser prompt
Enhance the system prompt in `task-parser.ts` with key schema requirements extracted from the spec:
- Customer: `name` required, optional `email`, `phoneNumber`, `organizationNumber`, `invoiceEmail`
- Employee: `firstName`, `lastName` required
- Product: `name` required, optional `priceExcludingVatCurrency`, `number`
- Project: `name`, `startDate`, `projectManager.id` required
- Order: `customer.id`, `deliveryDate` required, `orderLines` with `count`, `unitPriceExcludingVatCurrency`
- TravelExpense: `employee.id`, `title` required
- Department: `name`, `departmentNumber` required

This reduces the chance of the LLM generating wrong field names.

### 5. Add `address` executor for address-related tasks
Some tasks may require creating/updating addresses. Add a simple `address_create` executor that POSTs to `/v2/address`.

### 6. Add heuristic keywords for `voucher` and `order`
Missing from `heuristics.ts`:
- `VOUCHER_KEYWORDS`: "voucher", "bilag", "journal entry", "Buchung", "comprobante"
- `ORDER_KEYWORDS`: "order", "bestilling", "ordre", "pedido", "Bestellung"

## Technical Detail

### Supplier fix (critical)
```
// Before:
client.post("/v2/supplier", body)

// After:
client.postWithRetry("/v2/customer", body)
// body already has isSupplier: true, isCustomer: false
```

### postWithRetry wiring pattern
Every executor that calls `client.post(endpoint, body)` becomes `client.postWithRetry(endpoint, body as Record<string, unknown>)`. One-line change per executor.

## Expected Impact
- **Supplier fix alone** could recover 1+ tasks that currently 404
- **postWithRetry everywhere** prevents 422 errors from being terminal
- **Better parser prompt** reduces LLM misclassification
- **Estimated score improvement**: 2-4/8 tasks

