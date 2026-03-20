

# Diagnose og fiks: 0/8 score

## Problemet

Logane viser tydeleg kva som gjekk galt:

1. **Agenten utforskar i staden for å utføre** — Den prøvde `GET /v2/swagger.json`, testa random salary-endepunkt, og brukte 15 iterasjonar utan å fullføre oppgåva.
2. **Agenten fekk ei oppgåve den ikkje hadde info om** (salary) og gjekk i utforskingsmodus — prøving og feiling med 10+ 4xx-feil.
3. **Systemprompten manglar viktige instruksjonar** — Den seier ikkje tydeleg "ALDRI utforsk/gjet — berre bruk det du veit".
4. **Manglande endepunkt-dekning** — salary/payslip er ikkje i API-referansen, men agenten burde ha forstått at oppgåva handla om noko anna (t.d. employee med admin-rolle).

## Plan

### 1. Forsterke system-prompten med anti-utforsking-reglar
- Legg til: "ALDRI prøv å hente swagger.json eller utforske ukjende endepunkt"
- Legg til: "Dersom du ikkje veit korleis du gjer noko, prøv med dei endepunkta du kjenner, eller kall done med ein forklaring"
- Legg til: "Kvar feil (4xx) reduserer scoren. Planlegg FØR du kallar."
- Legg til: "Aldri gjer meir enn 2 forsøk på same endepunkt"

### 2. Utvide API-referansen med manglande endepunkt
Legg til i `COMPACT_API_REFERENCE` og `SCHEMA_REFERENCE`:
- Salary: `POST /salary/transaction`, `GET /salary/type`, `GET /salary/payslip` (basert på det vi ser i logane)
- Company modules: `POST /company/salesmodules`
- Employee entitlements: `PUT /employee/{id}/entitlement/:grantEntitlementsByTemplate`
- Credit notes: `PUT /invoice/{id}/:createCreditNote`

### 3. Forbetre agent-loop logikk
- Legg til ein teller for 4xx-feil per endepunkt — stopp etter 2 forsøk på same endepunkt
- Reduser `truncateData` grensa for å spare kontekstvindu
- Legg til ein timeout-sjekk (maks 240s totalt) for å unngå 5-minutts timeout

### 4. Filer som vert endra
- `supabase/functions/_shared/agent-loop.ts` — Forsterka system-prompt, anti-utforsking, timeout
- `supabase/functions/_shared/tripletex-api-reference.ts` — Utvida med salary, entitlements, modules
- Deploy `solve` og `auto-train`

## Tekniske detaljar

**System-prompt tillegg:**
```
## CRITICAL EFFICIENCY RULES
- Every 4xx error REDUCES your score. Plan before calling.
- NEVER try to fetch swagger.json or discover endpoints.
- NEVER make more than 2 attempts at the same endpoint.
- ONLY use endpoints listed in this reference.
- If unsure, use the closest known endpoint, don't explore.
- Total time limit is 4 minutes. Work fast.
```

**Timeout-mekanisme i agent-loop:**
```typescript
const TIMEOUT_MS = 240_000; // 4 min safety margin
if (Date.now() - loopStart > TIMEOUT_MS) {
  // call done immediately
}
```

**Feil-teller:**
```typescript
const endpointFailures = new Map<string, number>();
// Skip endpoint if already failed 2+ times
```

