// Confidence heuristics — lightweight pre-LLM signal boosting
// Enhanced with comprehensive multilingual keywords and boost patterns from Python planner

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

// ── Multi-language keyword maps (expanded from Python planner) ──

const CREATE_KEYWORDS = [
  "create", "opprett", "lag ", "registrer", "crear", "erstellen", "erstelle",
  "créer", "cree", "crée", "registrar", "criar", "add", "legg til",
  "ny", "new", "neu", "nouveau", "nuevo", "novo", "enregistrer", "registre",
];
const DELETE_KEYWORDS = [
  "delete", "slett", "fjern", "eliminar", "löschen", "losche", "supprimer",
  "excluir", "remove", "apaga", "borrar",
];
const UPDATE_KEYWORDS = [
  "update", "oppdater", "endre", "actualizar", "actualiza", "aktualisieren",
  "aktualisiere", "mettre à jour", "mettre a jour", "atualizar", "atualiza",
  "modify", "edit", "modifica", "rename",
];
const REVERSE_KEYWORDS = [
  "reverse", "reverser", "annuller", "cancel", "undo", "angre",
  "korrigir", "corriger", "correction",
];

const EMPLOYEE_KEYWORDS = [
  "employee", "ansatt", "ansette", "tilsett", "arbeidstaker",
  "empleado", "funcionário", "funcionario", "trabajador",
  "Mitarbeiter", "angestellte", "employé", "employe",
  "contrato de trabajo", "employment contract", "arbeidskontrakt",
  "personnummer", "personnel",
];
const CUSTOMER_KEYWORDS = [
  "customer", "kunde", "kund", "client", "cliente",
  "kunderegistrering", "kundeopprettelse", "Kunde",
];
const PRODUCT_KEYWORDS = [
  "product", "produkt", "producto", "Produkt", "produit",
  "produto", "artikel", "vare", "tjeneste",
];
const PAYMENT_KEYWORDS = [
  "payment", "betaling", "innbetaling", "pago", "Zahlung", "paiement",
  "pagamento", "betal", "paid", "bezahlt", "payé", "pagado",
  "full betaling", "full payment", "registrer betaling", "register payment",
  "reverse payment", "returned by the bank", "returnert av banken",
];
const INVOICE_KEYWORDS = [
  "invoice", "faktura", "factura", "Rechnung", "facture", "fatura",
  "overdue invoice", "late invoice", "outstanding invoice",
  "forfallen faktura", "utestaende faktura",
  "reminder fee", "frais de rappel",
];
const PROJECT_KEYWORDS = [
  "project", "prosjekt", "proyecto", "Projekt", "projet", "projeto",
  "prosjektleder", "project manager", "project leader",
];
const DEPARTMENT_KEYWORDS = [
  "department", "avdeling", "departamento", "Abteilung", "département",
  "avdelingsleder", "department manager", "department number",
  "avdelingsnummer",
];
const CREDIT_NOTE_KEYWORDS = [
  "credit note", "kreditnota", "kreditering", "krediter",
  "Gutschrift", "nota de crédito", "nota de credito",
  "note de crédit", "note de credit", "nota di credito",
  "credit invoice", "credit memo",
];
const TRAVEL_KEYWORDS = [
  "travel expense", "reiseregning", "reiseutgift", "reise",
  "gasto de viaje", "Reisekosten", "reisekost", "reisekosten",
  "frais de voyage", "despesa de viagem", "viagem", "voyage", "viaje",
  "ansattutlegg", "utlegg", "expense report",
];
const SUPPLIER_KEYWORDS = [
  "supplier", "leverandør", "leverandor", "proveedor",
  "Lieferant", "lieferant", "fournisseur", "fornecedor", "vendor",
];
const CONTACT_KEYWORDS = [
  "contact", "kontakt", "kontaktperson", "contacto",
  "Kontakt", "personne de contact",
];
const VOUCHER_KEYWORDS = [
  "voucher", "bilag", "bilagene", "journal entry", "Buchung",
  "comprobante", "asiento", "écriture", "ecriture",
  "regnskap", "accounting", "kontoplan", "hovedbok",
  "bokfor", "bokfør", "buchhaltung", "comptabilite",
  "contabilidade", "ledger",
];
const ORDER_KEYWORDS = [
  "order", "bestilling", "ordre", "pedido", "Bestellung", "commande",
];
const BANK_KEYWORDS = [
  "bank", "bankavstemming", "reconciliation", "kontoutskrift",
  "bank statement", "banktransaksjon", "kontoauszug",
  "bankgebyr", "kortgebyr", "renteinntekter", "rentekostnader",
];

// ── Boost patterns for confident matching ──

const BOOST_PATTERNS: Array<{ resource: string; patterns: RegExp[] }> = [
  {
    resource: "employee",
    patterns: [
      /(?:create|opprett|crear|criar|erstelle|cree)\s+(?:an?\s+)?(?:employee|ansatt|empleado|funcionario|mitarbeiter|employe)/i,
      /(?:contrato de trabajo|employment contract|arbeidskontrakt)/i,
    ],
  },
  {
    resource: "customer",
    patterns: [
      /(?:create|opprett|crear|criar|erstelle|cree)\s+(?:a\s+|en\s+)?(?:customer|kunde|cliente|client)/i,
      /(?:registre|register)\s+(?:o\s+|le\s+|el\s+)?(?:fornecedor|fournisseur|proveedor|supplier|leverandor|leverandør)/i,
    ],
  },
  {
    resource: "supplier",
    patterns: [
      /(?:create|opprett|crear|criar|erstelle|cree|registrer|register|registre|enregistrer)\s+(?:a\s+|en\s+|o\s+|le\s+|el\s+)?(?:supplier|leverandør|leverandor|fornecedor|fournisseur|proveedor|lieferant|vendor)/i,
    ],
  },
  {
    resource: "invoice",
    patterns: [
      /(?:create|opprett|lag|crear|criar|cree|erstelle)\s+(?:an?\s+|en\s+|ei\s+|et\s+|une\s+|uma\s+)?(?:invoice|faktura|factura|facture|fatura|rechnung)/i,
      /(?:overdue|late|outstanding)\s+invoice/i,
      /(?:forfallen|utestaende)\s+faktura/i,
      /(?:reminder fee|frais de rappel)/i,
    ],
  },
  {
    resource: "payment",
    patterns: [
      /(?:registrer|register|bokfor|bokfør|mark|sett)\s+(?:en\s+|ei\s+|et\s+)?(?:betaling|payment|innbetaling)/i,
      /(?:full\s+betaling|full\s+payment)/i,
      /(?:reverse\s+(?:the\s+)?payment|returned\s+by\s+the\s+bank|returnert\s+av\s+banken)/i,
    ],
  },
  {
    resource: "creditNote",
    patterns: [
      /(?:opprett|lag|create|issue|registrer|cree|emita|emite|emitir)\s+(?:en\s+|ei\s+|et\s+|a\s+|una\s+|um\s+)?(?:kreditnota|credit\s+note|credit\s+memo|nota\s+de\s+cr[eé]dito)/i,
    ],
  },
  {
    resource: "project",
    patterns: [
      /(?:create|opprett|crear|criar|erstelle|cree)\s+(?:a\s+|en\s+|et\s+)?(?:project|prosjekt|proyecto|projekt|projet|projeto)/i,
    ],
  },
  {
    resource: "travelExpense",
    patterns: [
      /(?:create|opprett|registrer|crear|criar|erstelle|cree)\s+(?:a\s+|en\s+|ei\s+)?(?:reiseregning|travel\s+expense|travel\s+report|reiseutgift)/i,
      /(?:slett|delete|remove|fjern)\s+(?:reiseregning|travel\s+expense)/i,
    ],
  },
  {
    resource: "voucher",
    patterns: [
      /(?:bilag|voucher|journal\s+entry|bokfor|bokfør)/i,
      /(?:debet|debit)\s+.+(?:kredit|credit)/i,
    ],
  },
];

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
  } else if (containsAny(prompt, REVERSE_KEYWORDS)) {
    likelyAction = "reverse";
    signals.push("reverse_keyword_detected");
  } else if (containsAny(prompt, UPDATE_KEYWORDS)) {
    likelyAction = "update";
    signals.push("update_keyword_detected");
  }

  // Check boost patterns first — highest confidence
  for (const { resource, patterns } of BOOST_PATTERNS) {
    for (const re of patterns) {
      if (re.test(prompt)) {
        likelyResource = resource;
        confidenceBoost += 0.15;
        signals.push(`boost_pattern:${resource}`);
        break;
      }
    }
    if (likelyResource) break;
  }

  // Fall back to keyword detection if no boost pattern matched
  if (!likelyResource) {
    const lower = prompt.toLowerCase();

    // Compound patterns
    const PROJECT_FOR_CUSTOMER_RE = /(?:prosjekt|project|proyecto|projekt|projet|projeto)\s+(?:for|til|para|für|pour)\s+(?:kunde|customer|client|cliente|Kunde)/i;
    const INVOICE_FOR_CUSTOMER_RE = /(?:faktura|invoice|factura|Rechnung|facture|fatura)\s+(?:for|til|para|für|pour)\s+(?:kunde|customer|client|cliente|Kunde)/i;

    if (containsAny(prompt, CREDIT_NOTE_KEYWORDS)) {
      likelyResource = "creditNote";
      signals.push("credit_note_keyword");
    } else if (containsAny(prompt, TRAVEL_KEYWORDS)) {
      likelyResource = "travelExpense";
      signals.push("travel_expense_keyword");
    } else if (containsAny(prompt, BANK_KEYWORDS)) {
      likelyResource = "voucher"; // Bank tasks often route to accounting/voucher
      signals.push("bank_keyword");
    } else if (PROJECT_FOR_CUSTOMER_RE.test(prompt)) {
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
    } else if (containsAny(prompt, VOUCHER_KEYWORDS)) {
      likelyResource = "voucher";
      signals.push("voucher_keyword");
    } else if (containsAny(prompt, PROJECT_KEYWORDS)) {
      likelyResource = "project";
      signals.push("project_keyword");
    } else if (containsAny(prompt, EMPLOYEE_KEYWORDS)) {
      likelyResource = "employee";
      signals.push("employee_keyword");
    } else if (containsAny(prompt, SUPPLIER_KEYWORDS)) {
      likelyResource = "supplier";
      signals.push("supplier_keyword");
    } else if (containsAny(prompt, CUSTOMER_KEYWORDS)) {
      likelyResource = "customer";
      signals.push("customer_keyword");
    } else if (containsAny(prompt, PRODUCT_KEYWORDS)) {
      likelyResource = "product";
      signals.push("product_keyword");
    } else if (containsAny(prompt, DEPARTMENT_KEYWORDS)) {
      likelyResource = "department";
      signals.push("department_keyword");
    } else if (containsAny(prompt, CONTACT_KEYWORDS)) {
      likelyResource = "contact";
      signals.push("contact_keyword");
    } else if (containsAny(prompt, ORDER_KEYWORDS)) {
      likelyResource = "order";
      signals.push("order_keyword");
    }
  }

  // Data signals
  if (EMAIL_RE.test(prompt)) {
    signals.push("has_email");
    if (likelyResource === "customer" || likelyResource === "employee") confidenceBoost += 0.03;
  }
  if (ORG_NR_RE.test(prompt)) {
    signals.push("has_org_number");
    if (likelyResource === "customer" || likelyResource === "supplier") confidenceBoost += 0.05;
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
