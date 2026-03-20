

## AI Accounting Agent for NM i AI — Tripletex Challenge

### Architecture Overview
- **POST /solve** as a Supabase Edge Function (HTTPS-ready, deployable)
- **Lovable AI Gateway** for LLM-powered task understanding (intent extraction, entity parsing, planning)
- **Minimal React test UI** for manual prompt simulation
- **Modular pipeline** within edge function + shared modules

### Backend: Edge Function Pipeline (`supabase/functions/solve/index.ts`)

The `/solve` endpoint receives a task payload and runs this pipeline:

1. **Input validation** — validate request body (task prompt, base URL, session token, optional attachments)
2. **Language detection** — use LLM to identify language (NO/EN/ES/PT/NN/DE/FR)
3. **Task normalization** — translate/normalize prompt to English for consistent processing
4. **Intent + Entity extraction** — LLM with structured tool calling to extract: intent (create/update/delete), resource type (employee/customer/invoice/etc.), required fields, dependencies
5. **Execution planning** — generate ordered steps with dependency resolution
6. **Tripletex API execution** — execute steps sequentially using dynamic client, store IDs for dependent steps
7. **Verification** — lightweight GET calls to confirm created/modified resources exist
8. **Response** — return `{"status":"completed"}` or error details

### Shared Modules (`supabase/functions/_shared/`)

- **tripletex-client.ts** — reusable API client (Basic Auth, GET/POST/PUT/DELETE, retry logic, logging)
- **agent-pipeline.ts** — orchestration pipeline coordinator
- **task-parser.ts** — LLM-powered intent/entity extraction with structured output schemas
- **task-planner.ts** — converts parsed intent into executable step sequence
- **task-executor.ts** — executes steps against Tripletex API with dependency resolution
- **task-verifier.ts** — post-execution verification
- **attachment-handler.ts** — attachment metadata parsing (stubbed OCR for v1)
- **logger.ts** — structured logging utility
- **types.ts** — all TypeScript interfaces (TaskPayload, ParsedTask, ExecutionPlan, Step, etc.)
- **mock-data.ts** — sample payloads and mock responses for testing

### Supported Task Categories (Architecture)

Create, update, delete operations for: employees, customers, products, invoices, payments, credit notes, projects, travel expenses, departments, corrections/reversals.

### Tripletex API Client Features

- Dynamic base URL + session token per request
- Basic Auth (username: "0", password: session token)
- Typed helpers for common endpoints (employee, customer, invoice, etc.)
- Automatic retry with exponential backoff for transient failures
- Request/response metadata logging (no sensitive data)

### Minimal Test UI (React Frontend)

Single-page developer tool with:
- Text area for task prompt
- Fields for Tripletex base URL and session token
- File upload for PDF/image attachments
- "Run Task" button
- Results panel showing: detected language, parsed intent, entities, execution plan, API call log, errors, final status
- Mock mode toggle for testing without real Tripletex calls
- Dark/neutral technical styling

### Mock Mode

- Toggle in UI and via request parameter
- Returns realistic simulated responses without hitting Tripletex
- Uses sample fixtures for all supported task types

### Sample Fixtures

- Example payloads in Norwegian, English, Spanish, Portuguese, Nynorsk, German, French
- Covering: create employee, register customer, create invoice, register payment, create project, etc.

