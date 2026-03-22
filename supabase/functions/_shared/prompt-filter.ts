/**
 * Prompt noise filter — extracts the actionable task from noisy prompts.
 * Ported from the Python project's extract_actionable_prompt logic.
 * 
 * Competition prompts often contain strategic memos, background articles,
 * and filler text. This module strips that noise to help the LLM focus.
 */

// Markers that indicate the REAL task follows
const TASK_MARKERS = [
  "task:", "actual task", "instruction:", "request:",
  "user request:", "oppgave:", "kommando:", "do this",
  "execute:", "solve:", "brukeroppgave:", "real task:",
];

// Keywords that indicate background/noise sections
const BACKGROUND_NOISE_KEYWORDS = [
  "strategic framework", "accounting automation landscape",
  "competitive analysis", "regulatory architecture",
  "implementation timeline", "the future of the profession",
  "talent development", "sustainability", "self-correction",
  "correctbench", "reasoning performance", "developer directives",
  "benchmarking", "landscape", "competitive", "regulatory",
  "regulation", "governance", "compliance", "benchmark",
  "strategy", "strategic", "optimization", "technical excellence",
  "ethics", "mandate",
];

// Tail markers that start a background section
const BACKGROUND_TAIL_MARKERS = [
  "background:", "context:", "this article", "this memo",
  "strategic memo", "strategic framework", "regulatory architecture",
  "implementation timeline", "developer directives", "guidelines:",
];

// Action keywords that signal a real task
const ACTION_KEYWORDS = [
  "opprett", "lag", "create", "crear", "criar", "cree", "crée",
  "erstelle", "registrer", "register", "registre", "enregistrer",
  "oppdater", "endre", "update", "actualiza", "atualiza",
  "mettre a jour", "mettre à jour", "aktualisiere", "modifica",
  "delete", "remove", "reverse", "slett", "annuller", "cancel",
  "book", "bokfor", "bokfør", "legg til", "add", "godkjenn",
  "approve", "pay", "betal",
];

// Entity keywords that confirm accounting domain
const ENTITY_KEYWORDS = [
  "employee", "ansatt", "supplier", "leverandør", "leverandor",
  "customer", "kunde", "product", "produkt", "invoice", "faktura",
  "credit note", "kreditnota", "payment", "betaling", "expense",
  "utlegg", "travel", "reise", "reiseregning", "bank", "project",
  "prosjekt", "department", "avdeling", "voucher", "bilag",
  "ledger", "accounting", "employee", "ansatt",
];

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const ORG_NUMBER_RE = /(?<!\d)\d{9}(?!\d)/;
const DATE_RE = /\b20\d{2}-\d{2}-\d{2}\b/;
const AMOUNT_RE = /\b\d+(?:[.,]\d{1,2})?\s*(?:nok|eur|usd|sek|dkk|kr)\b/i;

/**
 * Extract the actionable portion of a prompt, stripping background noise.
 */
export function extractActionablePrompt(prompt: string): string {
  if (!prompt || prompt.length < 50) return prompt;

  const lower = prompt.toLowerCase();

  // 1. Check for explicit task markers — extract everything after the marker
  for (const marker of TASK_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) {
      const afterMarker = prompt.slice(idx + marker.length).trim();
      if (afterMarker.length > 20 && hasEntityContent(afterMarker)) {
        return stripTrailingNoise(afterMarker);
      }
    }
  }

  // 2. Check for quoted actionable blocks
  const quoteMatch = prompt.match(/[""]([^""]{20,500})[""]/);
  if (quoteMatch && hasEntityContent(quoteMatch[1])) {
    return quoteMatch[1].trim();
  }

  // 3. Try to find the actionable section by splitting into paragraphs
  const paragraphs = prompt.split(/\n\s*\n/).filter(p => p.trim().length > 10);
  if (paragraphs.length > 1) {
    // Score each paragraph for actionability
    const scored = paragraphs.map(p => ({
      text: p.trim(),
      score: scoreActionability(p),
    }));

    const best = scored.reduce((a, b) => a.score > b.score ? a : b);
    if (best.score > 2 && best.text.length > 20) {
      return stripTrailingNoise(best.text);
    }
  }

  // 4. Strip trailing background sections
  return stripTrailingNoise(prompt);
}

function hasEntityContent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    ENTITY_KEYWORDS.some(kw => lower.includes(kw)) ||
    EMAIL_RE.test(text) ||
    ORG_NUMBER_RE.test(text) ||
    DATE_RE.test(text) ||
    AMOUNT_RE.test(text)
  );
}

function scoreActionability(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const kw of ACTION_KEYWORDS) {
    if (lower.includes(kw)) { score += 2; break; }
  }
  for (const kw of ENTITY_KEYWORDS) {
    if (lower.includes(kw)) { score += 1; break; }
  }
  if (EMAIL_RE.test(text)) score += 1;
  if (ORG_NUMBER_RE.test(text)) score += 1;
  if (DATE_RE.test(text)) score += 1;
  if (AMOUNT_RE.test(text)) score += 1;

  // Penalize noise
  for (const kw of BACKGROUND_NOISE_KEYWORDS) {
    if (lower.includes(kw)) { score -= 2; break; }
  }

  return score;
}

function stripTrailingNoise(text: string): string {
  const lower = text.toLowerCase();
  let cutIdx = text.length;

  for (const marker of BACKGROUND_TAIL_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx > 20 && idx < cutIdx) {
      // Only cut if the content before the marker has actionable content
      const before = text.slice(0, idx);
      if (hasEntityContent(before)) {
        cutIdx = idx;
      }
    }
  }

  return text.slice(0, cutIdx).trim();
}
