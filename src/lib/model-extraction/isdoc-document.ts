import type { PdfAccess, PdfAttachment } from "@/adapters/pdf/port";
import type { ModelExtractedPayload } from "@/modules/document-payload";
import { parseIsdocInvoice } from "@/modules/isdoc";

/** An embedded ISDOC is a few kilobytes; anything far larger is not one. */
const MAX_ISDOC_BYTES = 2_000_000;

/** The ISDOC invoice embedded in a PDF, read as data; null when there is none. */
export async function readEmbeddedIsdoc(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
): Promise<{ payload: ModelExtractedPayload; xml: string } | null> {
  let attachments: PdfAttachment[];
  try {
    attachments = await pdfAccess.extractAttachments(pdfBytes);
  } catch {
    return null;
  }
  for (const attachment of attachments) {
    if (attachment.content.length > MAX_ISDOC_BYTES) {
      continue;
    }
    const xml = new TextDecoder("utf-8").decode(attachment.content);
    const payload = parseIsdocInvoice(xml);
    if (payload) {
      return { payload, xml };
    }
  }
  return null;
}
