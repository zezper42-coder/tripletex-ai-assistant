// Confidence heuristics — lightweight pre-LLM signal boosting
// These run before the LLM call to provide hints and post-LLM to validate

import { Logger } from "./logger.ts";

interface HeuristicResult {
  likelyResource: string | null;
  likelyAction: string | null;
  confidenceBoost: number;
  signals: string[];
}

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/i;
const PHONE_RE = /\+?\d[\d\s-]{6,}/;
const ORG_NR_RE = /\b\d{9}\b/;

// Multi-language keyword maps
const CUSTOMER_KEYWORDS = [
  "customer", "kunde", "kund", "client", "cliente", "Kunde",
  "kunderegistrering", "kundeopprettelse",
];
const EMPLOYEE_KEYWORDS = [
  "employee", "ansatt", "arbeidstaker", "empleado", "funcionário",
  "Mitarbeiter", "employé", "tilsett",
];
const CREATE_KEYWORDS = [
  "create", "opprett", "lag", "registrer", "crear", "erstellen",
  "créer", "registrar", "add", "legg til", "ny", "new", "neu",
  "nouveau", "nuevo", "novo",
];
const DELETE_KEYWORDS = [
  "delete", "slett", "fjern", "eliminar", "löschen", "supprimer",
  "excluir", "remove",
];
const UPDATE_KEYWORDS = [
  "update", "oppdater", "endre", "actualizar", "aktualisieren",
  "mettre à jour", "atualizar", "modify", "edit",
];

const PRODUCT_KEYWORDS = ["product", "produkt", "producto", "Produkt", "produit", "produto"];
const PAYMENT_KEYWORDS = ["payment", "betaling", "innbetaling", "pago", "Zahlung", "paiement", "pagamento", "betal", "paid", "bezahlt", "payé", "pagado"];
const INVOICE_KEYWORDS = ["invoice", "faktura", "factura", "Rechnung", "facture", "fatura"];
const PROJECT_KEYWORDS = ["project", "prosjekt", "proyecto", "Projekt", "projet", "projeto"];
const DEPARTMENT_KEYWORDS = ["department", "avdeling", "departamento", "Abteilung", "département"];
const CREDIT_NOTE_KEYWORDS = ["credit note", "kreditnota", "kreditering", "krediter", "Gutschrift", "nota de crédito", "note de crédit", "nota di credito", "credit invoice", "reverse invoice", "reverser faktura"];
const TRAVEL_KEYWORDS = ["travel expense", "reiseregning", "reiseutgift", "gasto de viaje", "Reisekosten", "frais de voyage", "despesa de viagem"];
const SUPPLIER_KEYWORDS = ["supplier", "leverandør", "proveedor", "Lieferant", "fournisseur", "fornecedor"];
const CONTACT_KEYWORDS = ["contact", "kontakt", "kontaktperson", "contacto", "Kontakt", "personne de contact"];

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function runHeuristics(prompt: string, logger: Logger): HeuristicResult {
  const signals: string[] = [];
  let likelyResource: string | null = null;
  let likelyAction: string | null = null;
  let confidenceBoost = 0;

  // Detect action
  if (containsAny(prompt, CREATE_KEYWORDS)) {
    likelyAction = "create";
    signals.push("create_keyword_detected");
  } else if (containsAny(prompt, DELETE_KEYWORDS)) {
    likelyAction = "delete";
    signals.push("delete_keyword_detected");
  } else if (containsAny(prompt, UPDATE_KEYWORDS)) {
    likelyAction = "update";
    signals.push("update_keyword_detected");
  }

  // Detect resource — check more specific first (credit note > travel expense > others)
  // Also check for compound patterns like "project for customer" where the primary resource is project
  const lower = prompt.toLowerCase();

  // Check for compound patterns first — e.g. "opprett prosjekt for kunde X"
  const PROJECT_FOR_CUSTOMER_RE = /(?:prosjekt|project|proyecto|projekt|projet|projeto)\s+(?:for|til|para|für|pour)\s+(?:kunde|customer|client|cliente|Kunde)/i;
  const INVOICE_FOR_CUSTOMER_RE = /(?:faktura|invoice|factura|Rechnung|facture|fatura)\s+(?:for|til|para|für|pour)\s+(?:kunde|customer|client|cliente|Kunde)/i;

  if (containsAny(prompt, CREDIT_NOTE_KEYWORDS)) {
    likelyResource = "creditNote";
    signals.push("credit_note_keyword");
  } else if (containsAny(prompt, TRAVEL_KEYWORDS)) {
    likelyResource = "travelExpense";
    signals.push("travel_expense_keyword");
  } else if (PROJECT_FOR_CUSTOMER_RE.test(prompt)) {
    // "Create project for customer X" — primary resource is project
    likelyResource = "project";
    signals.push("project_for_customer_pattern");
  } else if (INVOICE_FOR_CUSTOMER_RE.test(prompt)) {
    likelyResource = "invoice";
    signals.push("invoice_for_customer_pattern");
  } else if (containsAny(prompt, INVOICE_KEYWORDS)) {
    likelyResource = "invoice";
    signals.push("invoice_keyword");
  } else if (containsAny(prompt, PAYMENT_KEYWORDS)) {
    likelyResource = "payment";
    signals.push("payment_keyword");
  } else if (containsAny(prompt, PROJECT_KEYWORDS)) {
    likelyResource = "project";
    signals.push("project_keyword");
  } else if (containsAny(prompt, EMPLOYEE_KEYWORDS)) {
    likelyResource = "employee";
    signals.push("employee_keyword");
    if (EMAIL_RE.test(prompt)) { confidenceBoost += 0.03; signals.push("has_email"); }
  } else if (containsAny(prompt, CUSTOMER_KEYWORDS)) {
    likelyResource = "customer";
    signals.push("customer_keyword");
    if (EMAIL_RE.test(prompt)) { confidenceBoost += 0.05; signals.push("has_email"); }
    if (ORG_NR_RE.test(prompt)) { confidenceBoost += 0.05; signals.push("has_org_number"); }
  } else if (containsAny(prompt, PRODUCT_KEYWORDS)) {
    likelyResource = "product";
    signals.push("product_keyword");
  } else if (containsAny(prompt, DEPARTMENT_KEYWORDS)) {
    likelyResource = "department";
    signals.push("department_keyword");
  }

  // Add general data signals (useful for conflict resolution weighting)
  if (EMAIL_RE.test(prompt) && !signals.includes("has_email")) {
    signals.push("has_email");
  }
  if (ORG_NR_RE.test(prompt) && !signals.includes("has_org_number")) {
    signals.push("has_org_number");
  }
  if (PHONE_RE.test(prompt)) {
    signals.push("has_phone");
  }

  if (likelyResource && likelyAction) {
    confidenceBoost += 0.1;
    signals.push("resource_and_action_matched");
  }

  logger.debug("Heuristics", { likelyResource, likelyAction, confidenceBoost, signals });
  return { likelyResource, likelyAction, confidenceBoost, signals };
}
