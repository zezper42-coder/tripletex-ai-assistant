

## Platform Constraint

Lovable cannot run Python or FastAPI. The platform supports **React/Vite** for frontend and **Supabase Edge Functions** (Deno/TypeScript) for backend. This project already has a working `POST /solve` edge function and test UI built in previous iterations.

## What Already Exists

- `supabase/functions/solve/index.ts` — POST /solve endpoint with full pipeline
- `supabase/functions/_shared/` — modular pipeline (parser, planner, executor, verifier, tripletex-client, logger, types, mock-data, attachment-handler)
- `src/components/SolveTestPanel.tsx` — developer test UI with prompt input, credentials, mock toggle, tabbed results
- `src/lib/sample-prompts.ts` — multi-language sample prompts

## Proposed Improvements

Rather than rebuilding what exists, I propose strengthening the current system to match all requirements in your prompt:

### 1. First Working Vertical Slice: "Create Customer"
- Harden `task-parser.ts` to reliably extract customer fields (name, email, org number, etc.)
- Harden `task-planner.ts` to generate correct Tripletex `/v2/customer` POST endpoint and body
- Harden `task-executor.ts` to execute the call and store the returned customer ID
- Harden `task-verifier.ts` to GET `/v2/customer/{id}` and confirm creation
- Test end-to-end with mock mode

### 2. Add Base64 File Upload to Test UI
- Add file upload control to `SolveTestPanel.tsx`
- Convert files to base64 with filename and mime_type
- Send as `attachments` array in the request body

### 3. Add Executor Routing by Task Type
- Create a task-type routing map in the executor so each resource type (customer, employee, invoice, etc.) has dedicated endpoint mappings and field schemas
- Add TODO markers for unimplemented task families

### 4. Add `/health` Endpoint
- Create `supabase/functions/health/index.ts` returning `{"status":"ok"}`

### 5. Improve Request Schema
- Update types to match the competition schema: `prompt`, `files` (with `filename`, `content_base64`, `mime_type`), `tripletex_credentials` (`base_url`, `session_token`)
- Add backward compatibility with existing field names

### 6. Add Realistic Stubs
- Add stub executors for: employee, customer, product, invoice, travel expense, project, correction
- Each with correct Tripletex API endpoint mappings and required field schemas

### 7. Update README
- Setup instructions, environment variables, how to test `/solve`, deployment info

## Technical Details

All backend code lives in `supabase/functions/`. The edge function is deployed automatically and is HTTPS-ready. The Tripletex client, LLM-powered parser, and pipeline orchestration are already functional. The main gap is hardening the vertical slices and adding file upload support.

