

# Plan: GPT-5.4 overalt + Agent Swarm fallback

## Del 1: Alle modellar til GPT-5.4

Tre filer brukar LLM-kall. To er allereie på GPT-5.4, éin brukar Gemini via gateway:

| Fil | No | Etter |
|---|---|---|
| `task-parser.ts` | `gpt-5.4` (direkte OpenAI) | Uendra |
| `task-planner.ts` | `gpt-5.4` (direkte OpenAI) | Uendra |
| `attachment-handler.ts` | `gemini-3.1-pro-preview` (Lovable gateway) | `gpt-5.4` (direkte OpenAI) |

**Endring**: `attachment-handler.ts` — byt frå Lovable AI Gateway til direkte OpenAI API med `gpt-5.4`. GPT-5.4 støttar vision/bilete, så OCR-funksjonaliteten vert betre med same modell.

## Del 2: Agent Swarm — dynamisk kode-generering som fallback

Når ein executor feilar ELLER ingen executor finst, aktiverer vi ein "swarm agent" som:

1. Sender feilen + oppgåva + Tripletex API-dokumentasjon til GPT-5.4
2. GPT-5.4 genererer ein serie med konkrete API-kall (method, endpoint, body) som løyser oppgåva
3. Systemet køyrer desse API-kalla mot Tripletex
4. Om det feilar igjen, sender vi feilmeldinga tilbake til GPT-5.4 for éin retry-runde

### Ny fil: `supabase/functions/_shared/agent-swarm.ts`

```text
┌─────────────────┐
│  Executor feiler │──────────┐
│  ELLER unknown   │          │
└─────────────────┘          ▼
                    ┌──────────────────┐
                    │  GPT-5.4 Swarm   │
                    │  Analyserer feil  │
                    │  + oppgåve        │
                    │  Genererer plan   │
                    └────────┬─────────┘
                             ▼
                    ┌──────────────────┐
                    │  Køyr API-kall   │
                    │  mot Tripletex   │
                    └────────┬─────────┘
                             │
                        Feilar? ──▶ Retry med feilmelding (1 gong)
                             │
                        Suksess ──▶ Return completed
```

Funksjonen tek inn: parsed task, feilmelding frå førre forsøk, TripletexClient, og returnerer ExecutorResult.

GPT-5.4 får eit system-prompt med komplett Tripletex API-referanse og vert beden om å returnere ei liste med API-kall via tool calling (same format som task-planner, men med ekstra kontekst om kva som gjekk galt).

### Endring i `agent-pipeline.ts`

- Etter at ein dedicated executor feilar (linje 98-101): kall swarm agent med feilinfo
- Etter at LLM planner-fallback feilar (linje 123-127): kall swarm agent med feilinfo
- Swarm-agenten er siste forsøk før vi returnerer "failed"

## Oppsummering av endringar

| Fil | Endring |
|---|---|
| `attachment-handler.ts` | Byt til direkte OpenAI API med gpt-5.4 |
| `agent-swarm.ts` (ny) | Agent swarm med GPT-5.4 for dynamisk problemløysing |
| `agent-pipeline.ts` | Integrer swarm som fallback ved feil |

