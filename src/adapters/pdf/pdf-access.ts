import type { PdfAccess, PdfTextLine } from "./port";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

async function openDocument(
  pdfBytes: Uint8Array,
  password?: string,
): Promise<import("pdfjs-dist/types/src/display/api").PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data: pdfBytes,
    password,
    useSystemFonts: true,
  }).promise;
}

function groupTextItemsIntoLines(
  items: Array<{ str: string; transform: number[] }>,
): PdfTextLine[] {
  const buckets = new Map<number, Array<{ x: number; text: string }>>();

  for (const item of items) {
    // The parser matches Slovak labels such as "NA ÚHRADU" as NFC literals; a
    // PDF producer emitting NFD would otherwise silently match nothing and send
    // every receipt to manual entry.
    const text = item.str.normalize("NFC").trim();
    if (text.length === 0) {
      continue;
    }
    const y = Math.round(item.transform[5] / 2) * 2;
    const x = item.transform[4];
    if (!buckets.has(y)) {
      buckets.set(y, []);
    }
    buckets.get(y)!.push({ x, text });
  }

  const sortedYs = [...buckets.keys()].sort((left, right) => right - left);
  return sortedYs.map((y) => {
    const row = buckets.get(y)!.sort((left, right) => left.x - right.x);
    return row.map((cell) => cell.text).join(" | ");
  });
}

export function createPdfAccess(): PdfAccess {
  return {
    async extractTextLines(pdfBytes, options) {
      const doc = await openDocument(pdfBytes, options?.password);
      const pageNumber = options?.pageNumber ?? 1;
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const textItems: Array<{ str: string; transform: number[] }> = [];
      for (const item of content.items) {
        if ("str" in item) {
          textItems.push({ str: item.str, transform: item.transform });
        }
      }
      return groupTextItemsIntoLines(textItems);
    },
  };
}
