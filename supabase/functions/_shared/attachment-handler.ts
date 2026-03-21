import { Logger } from "./logger.ts";
import { Attachment } from "./types.ts";

export interface AttachmentContent {
  filename: string;
  mimeType: string;
  textContent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Process attachments from the task payload.
 * V1: extracts metadata and basic text content.
 * Future: OCR, PDF parsing, image understanding via LLM vision.
 */
export async function processAttachments(
  attachments: Attachment[],
  apiKey: string,
  logger: Logger
): Promise<AttachmentContent[]> {
  if (!attachments?.length) {
    logger.info("No attachments to process");
    return [];
  }

  logger.info(`Processing ${attachments.length} attachment(s)`);
  const results: AttachmentContent[] = [];

  for (const att of attachments) {
    logger.info(`Attachment: ${att.filename} (${att.mimeType})`);

    const content: AttachmentContent = {
      filename: att.filename,
      mimeType: att.mimeType,
      metadata: { url: att.url, hasBase64: !!att.base64 },
    };

    // For text-based attachments, try to extract content
    if (att.mimeType.startsWith("text/") && att.base64) {
      try {
        content.textContent = atob(att.base64);
      } catch {
        logger.warn(`Failed to decode text attachment: ${att.filename}`);
      }
    }

    if (att.mimeType === "application/pdf" && att.base64) {
      const extractedPdfText = extractPdfText(att.base64);
      if (extractedPdfText) {
        content.textContent = extractedPdfText;
        logger.info(`Extracted PDF text for ${att.filename}`, { length: extractedPdfText.length });
      }
    }

    // For images — use OpenAI vision
    if (att.mimeType.startsWith("image/")) {
      if (att.base64 || att.url) {
        try {
          content.textContent = await extractWithVision(att, apiKey, logger);
        } catch (err) {
          logger.warn(`Vision extraction failed for ${att.filename}`, { error: String(err) });
        }
      }
    }

    results.push(content);
  }

  return results;
}

function extractPdfText(base64: string): string | undefined {
  try {
    const binary = atob(base64.replace(/\s+/g, ""));

    const textChunks = new Set<string>();

    const tjMatches = binary.matchAll(/\(((?:\\.|[^\\()]){3,})\)\s*T[Jj]/g);
    for (const match of tjMatches) {
      const cleaned = decodePdfString(match[1]);
      if (looksLikeUsefulText(cleaned)) {
        textChunks.add(cleaned);
      }
    }

    if (textChunks.size === 0) {
      const genericMatches = binary.matchAll(/\(((?:\\.|[^\\()]){5,})\)/g);
      for (const match of genericMatches) {
        const cleaned = decodePdfString(match[1]);
        if (looksLikeUsefulText(cleaned)) {
          textChunks.add(cleaned);
        }
        if (textChunks.size >= 40) break;
      }
    }

    const joined = Array.from(textChunks)
      .join("\n")
      .replace(/\s{2,}/g, " ")
      .trim();

    return joined.length >= 20 ? joined.slice(0, 4000) : undefined;
  } catch {
    return undefined;
  }
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\0/g, "")
    .trim();
}

function looksLikeUsefulText(value: string): boolean {
  const cleaned = value.replace(/[^\p{L}\p{N}@.,:;\-()/\s]/gu, "").trim();
  return cleaned.length >= 4 && /[\p{L}\p{N}]/u.test(cleaned);
}

async function extractWithVision(
  att: Attachment,
  apiKey: string,
  logger: Logger
): Promise<string | undefined> {
  logger.info(`Attempting vision extraction for ${att.filename}`);

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    logger.warn("OPENAI_API_KEY not set, skipping vision extraction");
    return undefined;
  }

  const imageContent = att.base64
    ? { type: "image_url" as const, image_url: { url: `data:${att.mimeType};base64,${att.base64}` } }
    : att.url
    ? { type: "image_url" as const, image_url: { url: att.url } }
    : null;

  if (!imageContent) return undefined;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "o3",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Extract ALL structured data from this document/image. Return as JSON with these fields where applicable:
- invoiceNumber, invoiceDate, dueDate
- customerName, customerEmail, customerPhone, customerAddress, organizationNumber
- supplierName, supplierEmail, supplierAddress
- lines (array of {description, quantity, unitPrice, vatRate, amount})
- totalAmount, totalVat, totalWithVat, currency
- employeeName, travelDate, travelDestination, travelPurpose
- any other relevant names, emails, phone numbers, dates, amounts
Return ONLY valid JSON, no markdown.` },
            imageContent,
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.warn("OpenAI Vision API failed", { status: response.status, error: errText });
    return undefined;
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content;
}
