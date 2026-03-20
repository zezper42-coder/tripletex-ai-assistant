import { CheckCircle2, AlertTriangle, XCircle, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

type Status = "full" | "partial" | "missing";

interface Capability {
  name: string;
  status: Status;
  pythonEquiv: string;
  ourImpl: string;
  note?: string;
}

interface Category {
  title: string;
  capabilities: Capability[];
}

const categories: Category[] = [
  {
    title: "Backend / API",
    capabilities: [
      { name: "HTTPS POST JSON endpoint", status: "full", pythonEquiv: "FastAPI", ourImpl: "Supabase Edge Function (Deno serve)", note: "Fullt fungerende /solve endpoint" },
      { name: "Request-validering", status: "full", pythonEquiv: "Pydantic v2", ourImpl: "TypeScript interfaces + runtime-sjekk i solve/index.ts", note: "Validerer task, credentials, attachments" },
      { name: "Async HTTP-klient med retries", status: "full", pythonEquiv: "httpx + tenacity", ourImpl: "TripletexClient med eksponentiell backoff (2 retries)", note: "500-retry + nettverksfeil-retry innebygd" },
      { name: "422 auto-recovery", status: "full", pythonEquiv: "Manuell", ourImpl: "postWithRetry / putWithRetry stripper ugyldige felt", note: "Unikt for vår løysing — Python-stacken manglar dette" },
      { name: "Testing", status: "partial", pythonEquiv: "pytest + TestClient", ourImpl: "Vitest + manuell curl-testing", note: "Har unit tests, manglar automatiserte integrasjonstester" },
    ],
  },
  {
    title: "Tripletex API-klient",
    capabilities: [
      { name: "Basic Auth (0:token)", status: "full", pythonEquiv: "requests/httpx auth", ourImpl: "TripletexClient med btoa(0:token)" },
      { name: "CRUD-operasjonar", status: "full", pythonEquiv: "Generert OpenAPI-klient", ourImpl: "Handskrive GET/POST/PUT/DELETE med typed responses" },
      { name: "Felta-filtrering (?fields=)", status: "partial", pythonEquiv: "OpenAPI-klient", ourImpl: "Støtta i queryParams, ikkje brukt konsekvent", note: "Kan spare bandbreidde" },
      { name: "Paginering", status: "partial", pythonEquiv: "Auto-paginering", ourImpl: "Manuell count/from-støtte", note: "Sjeldan nødvendig i konkurransen (fresh accounts)" },
    ],
  },
  {
    title: "PDF og vedlegg",
    capabilities: [
      { name: "PDF-tekstutrekk", status: "full", pythonEquiv: "PyMuPDF / pypdf", ourImpl: "GPT-5 Vision API via Lovable Gateway", note: "Sender PDF som base64 til VLM — betre enn rein OCR for strukturert data" },
      { name: "Bilete-analyse", status: "full", pythonEquiv: "Pillow + OCR", ourImpl: "GPT-5 Vision API", note: "Ekstraherer faktura-felt, namn, beløp direkte" },
      { name: "Base64-dekoding", status: "full", pythonEquiv: "python base64", ourImpl: "atob() for tekst, rå base64 til Vision API" },
      { name: "MIME-type handtering", status: "full", pythonEquiv: "python-magic", ourImpl: "Attachment.mimeType frå request payload" },
    ],
  },
  {
    title: "AI / NLP",
    capabilities: [
      { name: "Fleirspråkleg parsing (7 språk)", status: "full", pythonEquiv: "Ingen direkte ekvivalent", ourImpl: "GPT-5 via Lovable AI Gateway", note: "nb, en, es, pt, nn, de, fr — alle støtta" },
      { name: "Intent + entity extraction", status: "full", pythonEquiv: "Manuell / spaCy", ourImpl: "LLM-basert task-parser med confidence score" },
      { name: "Execution planning", status: "full", pythonEquiv: "Manuell", ourImpl: "LLM-generert plan + heuristikk-basert routing" },
      { name: "Agent swarm fallback", status: "full", pythonEquiv: "Ingen", ourImpl: "Multi-agent arkitektur med Tripletex API-referanse", note: "Unik styrke — handterer ukjende oppgåvetypar" },
    ],
  },
  {
    title: "Robustheit",
    capabilities: [
      { name: "Retry med backoff", status: "full", pythonEquiv: "tenacity", ourImpl: "Innebygd i TripletexClient (exp. backoff, 2 retries)" },
      { name: "Fuzzy string matching", status: "missing", pythonEquiv: "rapidfuzz", ourImpl: "Ikkje implementert", note: "Kunne forbetre namn-matching ved søk" },
      { name: "Rask JSON-serialisering", status: "full", pythonEquiv: "orjson", ourImpl: "V8 native JSON (like raskt i Deno)" },
      { name: "Solution caching", status: "full", pythonEquiv: "Ingen", ourImpl: "learned_solutions-tabell i database", note: "Unik — lagrar velykka planar for gjenbruk" },
      { name: "Felt-validering pre-flight", status: "full", pythonEquiv: "Ingen", ourImpl: "field-validation.ts stripper ugyldige felt ved 422" },
    ],
  },
  {
    title: "Oppgåvedekning (30 task types)",
    capabilities: [
      { name: "Customer CRUD", status: "full", pythonEquiv: "—", ourImpl: "customer-executor + customer-update-executor" },
      { name: "Employee CRUD + roller", status: "full", pythonEquiv: "—", ourImpl: "employee-executor + employee-update-executor" },
      { name: "Product", status: "full", pythonEquiv: "—", ourImpl: "product-executor med unit/VAT-retry" },
      { name: "Invoice", status: "full", pythonEquiv: "—", ourImpl: "invoice-executor med ordrelinje-støtte" },
      { name: "Project", status: "full", pythonEquiv: "—", ourImpl: "project-executor med auto-kundeoppretting" },
      { name: "Department", status: "full", pythonEquiv: "—", ourImpl: "department-executor" },
      { name: "Travel Expense", status: "full", pythonEquiv: "—", ourImpl: "travel-expense-create + travel-expense-executor" },
      { name: "Supplier", status: "full", pythonEquiv: "—", ourImpl: "supplier-executor" },
      { name: "Contact", status: "partial", pythonEquiv: "—", ourImpl: "contact-executor (stub)", note: "Grunnleggjande — treng meir feltdekning" },
      { name: "Payment", status: "partial", pythonEquiv: "—", ourImpl: "payment-executor (stub)" },
      { name: "Credit Note", status: "partial", pythonEquiv: "—", ourImpl: "credit-note-executor (stub)" },
      { name: "Voucher", status: "partial", pythonEquiv: "—", ourImpl: "voucher-executor (stub)" },
    ],
  },
];

function statusIcon(s: Status) {
  switch (s) {
    case "full": return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case "partial": return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    case "missing": return <XCircle className="h-5 w-5 text-red-500" />;
  }
}

function statusBadge(s: Status) {
  switch (s) {
    case "full": return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20">Dekka</Badge>;
    case "partial": return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/20">Delvis</Badge>;
    case "missing": return <Badge className="bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20">Manglar</Badge>;
  }
}

function computeStats() {
  let full = 0, partial = 0, missing = 0;
  for (const cat of categories) {
    for (const cap of cat.capabilities) {
      if (cap.status === "full") full++;
      else if (cap.status === "partial") partial++;
      else missing++;
    }
  }
  const total = full + partial + missing;
  return { full, partial, missing, total, pct: Math.round((full / total) * 100) };
}

export default function StackCoverage() {
  const stats = computeStats();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Stack-dekning vs. konkurransekrav</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Deno/TS Edge Functions vs. anbefalt Python-stack — kva vi dekker og kvar vi kan forbetre
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-emerald-600">{stats.pct}%</div>
              <div className="text-xs text-muted-foreground mt-1">Total dekning</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-emerald-600">{stats.full}</div>
              <div className="text-xs text-muted-foreground mt-1">Fullt dekka</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-amber-600">{stats.partial}</div>
              <div className="text-xs text-muted-foreground mt-1">Delvis dekka</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-red-600">{stats.missing}</div>
              <div className="text-xs text-muted-foreground mt-1">Manglar</div>
            </CardContent>
          </Card>
        </div>

        {/* Category sections */}
        {categories.map((cat) => (
          <Card key={cat.title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{cat.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {cat.capabilities.map((cap) => (
                  <div key={cap.name} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                    <div className="mt-0.5 shrink-0">{statusIcon(cap.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{cap.name}</span>
                        {statusBadge(cap.status)}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mt-1.5 text-xs text-muted-foreground">
                        <div><span className="font-medium text-foreground/70">Python-ekvivalent:</span> {cap.pythonEquiv}</div>
                        <div><span className="font-medium text-foreground/70">Vår impl:</span> {cap.ourImpl}</div>
                      </div>
                      {cap.note && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{cap.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Unique strengths */}
        <Card className="border-emerald-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-emerald-700">🚀 Unike styrkar (ikkje i Python-stacken)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>• <strong>422 auto-recovery</strong> — Stripper automatisk ugyldige felt og prøver på nytt</p>
            <p>• <strong>Agent swarm fallback</strong> — Handterer ukjende oppgåvetypar med fleirspråkleg API-referanse</p>
            <p>• <strong>Solution caching</strong> — Lagrar velykka planar i database for umiddelbar gjenbruk</p>
            <p>• <strong>VLM-basert vedleggs-parsing</strong> — GPT-5 Vision i staden for tradisjonell OCR, gir betre strukturert utrekk</p>
            <p>• <strong>Heuristikk-routing</strong> — Rask task-routing utan LLM-kall for kjende mønster</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
