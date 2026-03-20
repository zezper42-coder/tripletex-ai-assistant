

# Plan: Kritiske forbetringer for NM i AI-score

## Kontekst
Prosjektet brukar Supabase Edge Functions (Deno/TypeScript), ikkje Python/FastAPI. Det kan ikkje endrast — Lovable støttar ikkje Python-backend. Den eksisterande arkitekturen er solid, men har fleire ineffektivitetar og feil som må fiksast.

## Identifiserte problem (prioritert)

### A. Efficiency-drepande verifikasjonssteg
`task-verifier.ts` gjer GET-kall på ALLE write-operasjonar i LLM-fallback-pathen. Dette doblar API-kall og drep efficiency bonus. Bør fjernast heilt — `agent-pipeline.ts` skal skippe verifikasjon.

### B. Employee executor gjer for mange API-kall
Gjer 2 GET-kall for department lookup (søk + fallback list) sjølv for enkel employee-opprettelse. Bør berre gjere 1 kall.

### C. Manglande heuristic-nøkkelord
`supplier` og `contact` manglar i heuristics — desse blir aldri routing-matcha korrekt.

### D. LLM fallback brukar dyr modell
`task-planner.ts` brukar `openai/gpt-5` — for tregt/dyrt. Byt til `google/gemini-2.5-flash`.

### E. Ingen auto-retry på 422
Når Tripletex returnerer 422 med `validationMessages`, krasjar executors utan å prøve å fikse.

### F. Supplier brukar feil endpoint
Tripletex supplier-endpointet er `/v2/supplier` men nokon oppgåver kan krevje `/v2/customer` med `isSupplier: true`.

---

## Implementasjonsplan

### 1. Fjern verifikasjon i pipeline (agent-pipeline.ts)
- Fjern kallet til `verifyExecution()` i LLM-fallback-pathen
- Sett `verified: true` direkte når alle steg lukkast
- **Sparar 1-3 API-kall per oppgåve**

### 2. Optimaliser employee executor
- Slå saman department lookup til éin effektiv kall
- Berre søk department viss det er spesifisert i oppgåva, elles hopp over
- Fjern department-kravet — Tripletex krev det ikkje alltid

### 3. Legg til manglande heuristic-nøkkelord (heuristics.ts)
- Legg til `SUPPLIER_KEYWORDS`: "supplier", "leverandør", "proveedor", "Lieferant", "fournisseur"
- Legg til `CONTACT_KEYWORDS`: "contact", "kontakt", "kontaktperson", "contacto", "Kontakt"
- Oppdater `runHeuristics` til å sjekke desse

### 4. Byt LLM-modell i planner
- `task-planner.ts`: Endre frå `openai/gpt-5` til `google/gemini-2.5-flash`
- `task-parser.ts`: Behald `openai/gpt-5-mini` (allereie rask)

### 5. Legg til 422 auto-retry i alle executors
- Lag ein `retryOn422`-hjelpefunksjon i `field-validation.ts`
- Viss 422, les `validationMessages`, fjern problematiske felt, prøv éin gong til
- Maksimalt 1 retry for å unngå 4xx-straff

### 6. Legg til `ledger/voucher` executor
- Ny executor for bilag-opprettelse (Tier 3-oppgåver)
- POST `/v2/ledger/voucher` med debiteringskonti og krediteringskonti

### 7. Forbetre attachment-handler prompt
- Meir spesifikk OCR-prompt som ber om fakturanummer, beløp, MVA, kundeinfo
- Returner strukturert JSON, ikkje fritekst

## Teknisk oversikt

```text
Før:  prompt → heuristics → LLM parse → executor → [verifikasjon GET] → svar
Etter: prompt → heuristics → LLM parse → executor → [422 retry?] → svar

API-kall spart per oppgåve: 1-3
```

## Forventa effekt
- **Efficiency bonus**: Drastisk betre med færre API-kall
- **Coverage**: Supplier/contact/voucher dekkjer fleire oppgåvetypar
- **Robustheit**: 422 auto-retry reduserer 0-score på valideringsfeil

