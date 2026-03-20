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

    // For images/PDFs — use LLM vision in future
    if (att.mimeType === "application/pdf" || att.mimeType.startsWith("image/")) {
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

async function extractWithVision(
  att: Attachment,
  apiKey: string,
  logger: Logger
): Promise<string | undefined> {
  logger.info(`Attempting vision extraction for ${att.filename}`);

  const imageContent = att.base64
    ? { type: "image_url" as const, image_url: { url: `data:${att.mimeType};base64,${att.base64}` } }
    : att.url
    ? { type: "image_url" as const, image_url: { url: att.url } }
    : null;

  if (!imageContent) return undefined;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-pro-preview",
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
    logger.warn("Vision API failed", { status: response.status });
    return undefined;
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content;
}
