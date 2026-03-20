

# Plan: Auto-tester med GPT-5.4 oppgåvegenerator + treningsloop

## Oversikt

Lagar ein ny edge function `auto-train` og ein ny UI-fane i test-konsollen. GPT-5.4 genererer realistiske, vanskelege Tripletex-oppgåver (med tekst, PDF-vedlegg, bilete, korrupte filer, fleirspråklege oppgåver). Kvar oppgåve vert køyrt mot `/solve`. Feil vert fanga opp, og løysingar vert lagra i `learned_solutions` for framtidig gjenbruk.

## Del 1: Ny edge function `supabase/functions/auto-train/index.ts`

Éin funksjon som:

1. **Genererer oppgåver**: Kallar GPT-5.4 med eit system-prompt som ber den generere ei realistisk Tripletex-oppgåve. Promptet inkluderer alle støtta ressurstypar og ber om variasjon i:
   - Språk (nb, nn, en, de, es, pt, fr)
   - Ressurstype (customer, employee, invoice, payment, creditNote, voucher, travelExpense, project, department, supplier, contact, product)
   - Intent (create, update, delete, list)
   - Kompleksitet (enkle, fleirstegs, med vedlegg)
   - Vedlegg (genererer fake base64 PDF/bilete med oppgåvedata innbakt)

2. **Køyrer oppgåva internt**: Kallar `runPipeline()` direkte (ikkje HTTP) med Tripletex-credentials frå request body.

3. **Loggar resultat**: Returnerer ein rapport med kva som lukkast/feila, kva swarm-agenten gjorde, og kva som vart lagra i cache.

4. **Batch-modus**: Tek `iterations` parameter (default 10). Køyrer N runder og returnerer aggregert resultat.

Request body:
```json
{
  "tripletexApiUrl": "https://api.tripletex.io",
  "sessionToken": "...",
  "iterations": 20,
  "categories": ["customer", "invoice", "employee"]  // optional filter
}
```

Response:
```json
{
  "totalRuns": 20,
  "succeeded": 17,
  "failed": 3,
  "newSolutionsLearned": 12,
  "results": [
    { "task": "...", "category": "invoice_create", "status": "completed", "swarmUsed": false, "duration": 2300 },
    ...
  ]
}
```

## Del 2: Oppdater `SolveTestPanel.tsx` — ny "Auto Train" fane

Legg til ein ny tab i test-konsollen med:

- **Iterations** input (tal, default 10)
- **Category filter** (multi-select checkboxes for resource types)
- **Tripletex credentials** (gjenbruk eksisterande felt)
- **"Start Training" knapp** som kallar `/auto-train`
- **Live resultat-tabell** som viser kvar oppgåve med status, duration, om swarm vart brukt
- **Aggregert statistikk** øvst: total, succeeded, failed, solutions learned
- **Progress bar** som oppdaterer seg undervegs

## Del 3: Filar som vert endra/oppretta

| Fil | Endring |
|---|---|
| `supabase/functions/auto-train/index.ts` | Ny edge function — oppgåvegenerator + pipeline-runner |
| `src/components/SolveTestPanel.tsx` | Ny "Auto Train" fane med UI for batch-trening |

## Tekniske detaljar

- Oppgåvegeneratoren brukar GPT-5.4 via direkte OpenAI API (`OPENAI_API_KEY`)
- Pipeline køyrer med ekte Tripletex-credentials (ikkje mock mode)
- Kvar iterasjon: generate → solve → log → neste
- Resultata inkluderer om `swarm` vart aktivert og om løysinga vart lagra i cache
- Edge function har 5-min timeout per request, så vi held iterasjonar innanfor den grensa
- GPT-5.4 vert bedt om å variere mellom enkle og komplekse oppgåver, inkludert multi-steg-oppgåver (t.d. "opprett kunde, lag faktura, registrer betaling")

