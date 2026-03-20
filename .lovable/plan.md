

# Plan: Maksimer NM i AI-score — Kritiske fiksar og live-testing

## Situasjon
- Siste submit: **0/8 (0%)**
- 10 executors finst, men ingen er live-testa med ekte Tripletex-sandbox
- Du har delt ein fersk sandbox-token som vi kan bruke til testing

## Hovudproblem identifisert
1. **Ingen live-testing** — vi har aldri verifisert at executors faktisk fungerer mot ekte API
2. **Efficiency bonus** — verifikasjonssteg (GET etter POST) kostar ekstra API-kall og kan redusere score
3. **Attachment/PDF-parsing** — brukar `openai/gpt-5` som er dyrt og tregt; bør bruke `openai/gpt-5-mini`
4. **Manglande `supplier_create`** — kan vere blant oppgåvetypane

## Plan (prioritert rekkefølgje)

### 1. Live-test alle executors mot sandbox
Bruke tokenet du delte til å køyre ekte API-kall mot sandboxen for kvar executor-type:
- `customer_create` → POST /v2/customer
- `employee_create` → POST /v2/employee + entitlement
- `product_create` → POST /v2/product
- `department_create` → POST /v2/department
- `project_create` → POST /v2/project (med startDate + projectManager)
- `invoice_create` → POST /v2/order → PUT /:invoice
- `payment_create` → POST /v2/payment
- `credit_note_create` → PUT /:createCreditNote
- `travel_expense_create` → POST /v2/travelExpense

Logge feil og fikse body-format basert på faktiske valideringsfeil.

### 2. Fjern unødvendige verifikasjonssteg
Kvar executor gjer ein ekstra GET etter POST for å "verifisere". Dette kostar API-kall og reduserer efficiency bonus. Fjern alle verifikasjons-GET-kall — ein 2xx-respons med ID er nok.

### 3. Optimaliser attachment-handler
- Byt modell frå `openai/gpt-5` til `google/gemini-2.5-flash` (billigare, raskare, like god på OCR)
- Gje meir spesifikk prompt: "Trekk ut alle felt som namn, beløp, dato, adresse, etc."

### 4. Legg til `supplier_create` executor
Tripletex API har `/v2/supplier` — legg til enkel executor etter same mønster som customer.

### 5. Legg til `contact_create` executor
`/v2/contact` — enkel POST med firstName, lastName, email, customer/supplier-referanse.

### 6. Robustgjer feilhåndtering
- Dersom ein executor får 422, logg `validationMessages` og prøv å fikse body automatisk (f.eks. fjern ugyldige felt og prøv på nytt)
- Ikkje prøv meir enn 1 retry for å unngå 4xx-straff

### 7. Legg til `update`-executors for employee og customer
Mange oppgåver kan handle om å oppdatere eksisterande data. Legg til:
- `employee_update` — GET + PUT /v2/employee/{id}
- `customer_update` — GET + PUT /v2/customer/{id}

## Teknisk detalj

### Verifikasjons-fjerning (alle executors)
Fjern mønsteret:
```
if (success) {
  const check = await client.get(`/v2/resource/${id}`);
  verified = check.status === 200;
}
```
Sett `verified: true` direkte når status er 2xx.

### Supplier executor
Identisk med customer-executor men med `isSupplier: true, isCustomer: false`.

### Update-executors
1. Søk etter eksisterande ressurs (GET med namn/email)
2. Merg nye felt inn i eksisterande data
3. PUT med version-feltet frå GET-responsen (Tripletex krev dette)

## Forventa effekt
- **Fjerne verifikasjon** → sparer 1 API-kall per oppgåve → betre efficiency bonus
- **Live-testing** → avdekker og fiksar faktiske body-format-feil
- **Fleire executors** → dekkjer fleire oppgåvetypar → fleire poeng
- **Estimert score**: 4-6/8 med desse endringane

