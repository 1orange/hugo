import type { PdfAccess, PdfAttachment } from "@/adapters/pdf/port";
import type { ModelExtractedPayload } from "@/modules/document-payload";
import { parseIsdocInvoice } from "@/modules/isdoc";
import { parseMolInvoice } from "@/modules/mol-invoice";

/** An embedded invoice is a few kilobytes; anything far larger is not one. */
const MAX_INVOICE_XML_BYTES = 2_000_000;

/**
 * The invoice a PDF carries as data — an ISDOC, or a MOL e-invoice (Slovnaft's
 * fuel cards) — read as such; null when it carries neither.
 */
export async function readEmbeddedInvoiceXml(
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
    if (attachment.content.length > MAX_INVOICE_XML_BYTES) {
      continue;
    }
    const xml = new TextDecoder("utf-8").decode(attachment.content);
    const payload = parseIsdocInvoice(xml) ?? parseMolInvoice(xml);
    if (payload) {
      return { payload, xml };
    }
  }
  return null;
}
