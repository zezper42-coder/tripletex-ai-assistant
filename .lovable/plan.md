

# Redesign: From Deterministic Executors to Agentic ReAct Loop

## Problem
The current system uses hardcoded if/else routing (`task-router.ts` → 32 executor files) to pick pre-built API call sequences. This is brittle — any task variation the executor doesn't handle fails. The LLM is only used for parsing, not for deciding actions.

## New Architecture

Replace the executor-based pipeline with a **ReAct agent loop** where the LLM:
1. Reads the task + OpenAPI reference
2. Decides which API call to make next
3. Observes the result
4. Decides the next action (or stops)

```text
┌─────────────────────────────────────────────┐
│              AGENT LOOP                     │
│                                             │
│  Task + API Reference                       │
│       ↓                                     │
│  ┌─────────────┐                            │
│  │  LLM THINK  │ ← observation from prev    │
│  │  + DECIDE   │                            │
│  └──────┬──────┘                            │
│         ↓                                   │
│   { action: "api_call",                     │
│     method: "POST",                         │
│     endpoint: "/v2/customer",               │
│     body: {...} }                            │
│         ↓                                   │
│  ┌──────────────┐                           │
│  │ EXECUTE CALL │ → TripletexClient         │
│  └──────┬───────┘                           │
│         ↓                                   │
│   observation: { status: 201, data: {...} } │
│         ↓                                   │
│   Loop back to LLM THINK (max 10 iters)    │
│         or                                  │
│   { action: "done" } → return result        │
└─────────────────────────────────────────────┘
```

## Implementation Plan

### 1. Create `supabase/functions/_shared/agent-loop.ts` (new file)
The core ReAct agent. Single function `runAgentLoop(task, client, logger)`:
- System prompt contains the full `COMPACT_API_REFERENCE` + `SCHEMA_REFERENCE` + Tripletex conventions
- Uses **tool calling** with two tools:
  - `api_call(method, endpoint, body?, queryParams?)` — executes a Tripletex API request
  - `done(summary)` — signals task completion
- Loop: send messages to LLM → get tool call → execute → append observation → repeat
- Max 10 iterations, safety timeout
- Each iteration appends the API response as an observation message
- Uses `google/gemini-3.1-pro-preview` model

### 2. Rewrite `supabase/functions/_shared/agent-pipeline.ts`
Simplify drastically. New flow:
1. Process attachments (keep)
2. Call `runAgentLoop(fullPrompt, client, logger)` directly — no parsing, no heuristics, no routing, no executor lookup
3. Return result
- Remove imports of: `parseTask`, `planExecution`, `runHeuristics`, `resolveTaskType`, `getExecutor`, `runSwarmFallback`, `findCachedSolution`, `saveSolution`
- The agent IS the parser, planner, and executor all in one

### 3. Save the full OpenAPI spec as a compressed reference
- Update `tripletex-api-reference.ts` to include the complete `SCHEMA_REFERENCE` and `COMPACT_API_REFERENCE` in the agent's system prompt
- No changes needed here — the existing reference is already comprehensive

### 4. Keep existing infrastructure
- `TripletexClient` — used by the agent loop to execute calls
- `Logger` — used for structured logging
- `types.ts` — keep `PipelineResult`, `StepResult`, etc.
- `attachment-handler.ts` — still needed
- `solve/index.ts` — no changes needed (calls `runPipeline`)

### 5. Files that become unused (but can stay for now)
- All 32 executor files in `executors/`
- `task-router.ts`
- `task-parser.ts`
- `task-planner.ts`
- `task-executor.ts`
- `heuristics.ts`
- `agent-swarm.ts`
- `solution-cache.ts`
- `task-verifier.ts`

## Technical Details

**Agent system prompt** will include:
- Full API reference with all endpoints, required fields, field types
- Tripletex conventions (postalAddress, {id} refs, query params for payments, etc.)
- Instructions to think step-by-step, observe results, and self-correct on errors
- Examples of multi-step workflows (create customer → create order → invoice)

**Tool schema for `api_call`**:
```json
{
  "name": "api_call",
  "parameters": {
    "method": "GET|POST|PUT|DELETE",
    "endpoint": "/v2/...",
    "body": { ... },
    "queryParams": { ... },
    "reasoning": "why this call"
  }
}
```

**Error recovery**: If an API call returns 4xx, the observation goes back to the LLM, which can adjust fields, try a different endpoint, or look up missing data — all dynamically without hardcoded retry logic.

**Performance**: The agent loop adds ~1-3 LLM calls per task (think + act cycles). With Gemini 3.1 Pro this should complete within the 180s time limit. Simple tasks (create customer) will be 1-2 iterations. Complex tasks (invoice with payment) may take 3-5.

