# Tripletex AI Accounting Agent — NM i AI

An AI-powered accounting agent that receives natural-language tasks, interprets them, executes the correct Tripletex API calls, and returns completion status.

## Architecture

- **Backend**: Supabase Edge Function (`POST /solve`) — Deno/TypeScript
- **Frontend**: React/Vite test console for manual debugging
- **AI**: Lovable AI Gateway (GPT-5) for task parsing and planning

### Pipeline

1. Input validation & attachment processing
2. LLM-powered task parsing (language detection, intent, entity extraction)
3. Execution planning (ordered API call steps with dependency resolution)
4. Sequential Tripletex API execution
5. Verification (confirm created/modified resources)
6. Response: `{"status":"completed"}`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/solve` | POST | Main task execution endpoint |
| `/health` | GET | Health check |

### POST /solve — Request Body

**Competition format:**
```json
{
  "task": "Create a customer named Acme AS with email post@acme.no",
  "tripletexApiUrl": "https://api.tripletex.io",
  "sessionToken": "abc123",
  "attachments": [
    { "filename": "invoice.pdf", "mimeType": "application/pdf", "base64": "..." }
  ]
}
```

**Alternative format (also supported):**
```json
{
  "prompt": "...",
  "tripletex_credentials": { "base_url": "...", "session_token": "..." },
  "files": [{ "filename": "...", "content_base64": "...", "mime_type": "..." }]
}
```

### Response

Competition mode (default): `{"status":"completed"}`

Debug mode (set header `x-debug: true`): full pipeline result with parsed task, plan, step results, and logs.

### Mock Mode

Add `"mockMode": true` to skip real Tripletex calls and get simulated responses.

## Supported Task Categories

| Category | Status |
|----------|--------|
| Customer | ✅ Full |
| Employee | ✅ Full |
| Product | ✅ Full |
| Invoice | ✅ Full |
| Project | ✅ Full |
| Department | ✅ Full |
| Travel Expense | ✅ Full |
| Payment | 🔧 Stub |
| Credit Note | 🔧 Stub |
| Voucher | 🔧 Stub |
| Contact | 🔧 Stub |
| Order | 🔧 Stub |

## Project Structure

```
supabase/functions/
├── solve/index.ts              # POST /solve endpoint
├── health/index.ts             # GET /health endpoint
└── _shared/
    ├── agent-pipeline.ts       # Pipeline orchestrator
    ├── task-parser.ts          # LLM intent/entity extraction
    ├── task-planner.ts         # Execution plan generation
    ├── task-executor.ts        # Sequential API execution
    ├── task-verifier.ts        # Post-execution verification
    ├── resource-schemas.ts     # Tripletex resource field schemas
    ├── tripletex-client.ts     # Reusable API client (Basic Auth)
    ├── attachment-handler.ts   # PDF/image processing
    ├── logger.ts               # Structured logging
    ├── mock-data.ts            # Mock responses for testing
    └── types.ts                # TypeScript interfaces

src/
├── components/SolveTestPanel.tsx  # Developer test UI
├── lib/sample-prompts.ts          # Multi-language sample prompts
└── pages/Index.tsx                # Entry point
```

## Environment

The project runs on Lovable Cloud. Required secrets (auto-configured):
- `LOVABLE_API_KEY` — for AI Gateway access

## Testing

1. Open the app preview
2. Toggle **Mock mode** on
3. Click a language sample button (NB, EN, ES, etc.)
4. Click **Run Task**
5. Inspect results in the Parsed/Plan/Results/Logs tabs

For real Tripletex testing, disable mock mode and provide valid API URL + session token.

## Deployment

The edge functions deploy automatically via Lovable Cloud. The solve endpoint is HTTPS-ready at:

```
https://<project-id>.supabase.co/functions/v1/solve
```

## Tripletex Auth

All API calls use Basic Auth:
- Username: `0`
- Password: session token (provided per request)
