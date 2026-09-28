import { readingOrderPages, type PositionedText } from "../../modules/reading-order";
import type { PdfAccess, PdfAttachment, PdfPageImage, PdfTextLine } from "./port";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfPageProxy = Awaited<
  ReturnType<Awaited<ReturnType<PdfJsModule["getDocument"]>["promise"]>["getPage"]>
>;

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
    // pdf.js transfers the buffer it is given and leaves the caller's empty,
    // so every read gets its own copy: a scan is read for its text layer and
    // then again for its page images.
    data: pdfBytes.slice(),
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

type PdfTextItem = { str: string; transform: number[]; width?: number; height?: number };

// pdf.js gives the baseline's start and the run's width and font height, in
// points with y growing upwards; the reading order wants boxes with y down.
function textItemToBox(item: PdfTextItem): PositionedText {
  const [, , c = 0, d = 0, x = 0, baseline = 0] = item.transform;
  const height = item.height || Math.hypot(c, d) || 8;
  const width = item.width || item.str.length * height * 0.5;
  return {
    text: item.str,
    left: x,
    right: x + width,
    top: -(baseline + height * 0.8),
    bottom: -(baseline - height * 0.2),
  };
}

type RawPdfImage = {
  data?: Uint8ClampedArray | Uint8Array;
  width?: number;
  height?: number;
  kind?: number;
  src?: Uint8Array | null;
  bitmap?: { data: Uint8ClampedArray; width: number; height: number };
};

function pdfImageToPageImage(
  raw: RawPdfImage,
  rgbKind: number,
): PdfPageImage | null {
  if (raw.bitmap?.data && raw.bitmap.width && raw.bitmap.height) {
    return {
      kind: "rgba",
      data: raw.bitmap.data,
      width: raw.bitmap.width,
      height: raw.bitmap.height,
    };
  }

  if (raw.src && raw.src.length > 0) {
    return { kind: "encoded", bytes: new Uint8Array(raw.src) };
  }

  if (!raw.data || !raw.width || !raw.height) {
    return null;
  }

  if (raw.kind === rgbKind) {
    const rgb = raw.data;
    const rgba = new Uint8ClampedArray(raw.width * raw.height * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgba[j] = rgb[i]!;
      rgba[j + 1] = rgb[i + 1]!;
      rgba[j + 2] = rgb[i + 2]!;
      rgba[j + 3] = 255;
    }
    return { kind: "rgba", data: rgba, width: raw.width, height: raw.height };
  }

  const rgba =
    raw.data instanceof Uint8ClampedArray
      ? raw.data
      : new Uint8ClampedArray(raw.data);
  return { kind: "rgba", data: rgba, width: raw.width, height: raw.height };
}

async function extractImagesFromPage(
  page: PdfPageProxy,
  pdfjs: PdfJsModule,
): Promise<PdfPageImage[]> {
  const { OPS, ImageKind } = pdfjs;
  const operatorList = await page.getOperatorList();
  const images: PdfPageImage[] = [];
  const paintOps = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageXObjectRepeat,
  ]);

  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const fn = operatorList.fnArray[index]!;
    if (!paintOps.has(fn)) {
      continue;
    }

    const args = operatorList.argsArray[index]!;
    let raw: RawPdfImage | null = null;
    if (fn === OPS.paintInlineImageXObject) {
      raw = args[0] as RawPdfImage;
    } else {
      const objectId = args[0] as string;
      try {
        raw = page.objs.get(objectId) as RawPdfImage;
      } catch {
        raw = null;
      }
    }

    const converted = raw ? pdfImageToPageImage(raw, ImageKind.RGB_24BPP) : null;
    if (converted) {
      images.push(converted);
    }
  }

  return images;
}

export function createPdfAccess(): PdfAccess {
  return {
    async extractTextLines(pdfBytes, options) {
      const doc = await openDocument(pdfBytes, options?.password);
      const pageNumbers =
        options?.maxPages !== undefined
          ? Array.from(
              { length: Math.min(doc.numPages, Math.max(1, options.maxPages)) },
              (_, index) => index + 1,
            )
          : [options?.pageNumber ?? 1];
      const pages: PdfTextItem[][] = [];
      for (const pageNumber of pageNumbers) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const textItems: PdfTextItem[] = [];
        for (const item of content.items) {
          if ("str" in item) {
            textItems.push({
              str: item.str,
              transform: item.transform,
              width: item.width,
              height: item.height,
            });
          }
        }
        pages.push(textItems);
      }
      if (options?.order === "reading") {
        return readingOrderPages(pages.map((items) => items.map(textItemToBox)));
      }
      // Grouped per page: y-coordinates restart on every page.
      return pages.flatMap((items) => groupTextItemsIntoLines(items));
    },
    async extractAttachments(pdfBytes) {
      const doc = await openDocument(pdfBytes);
      // pdf.js 6 lists attachments by id and loads each one's bytes on request.
      const listed = (await doc.getAttachments()) as Map<string, { filename?: string }> | null;
      const attachments: PdfAttachment[] = [];
      for (const [id, entry] of listed ?? []) {
        const content = (await doc.getAttachmentContent(id)) as unknown;
        if (content instanceof Uint8Array) {
          attachments.push({ filename: entry.filename ?? id, content });
        }
      }
      return attachments;
    },
    async extractPageImages(pdfBytes) {
      const pdfjs = await loadPdfJs();
      const doc = await openDocument(pdfBytes);
      const images: PdfPageImage[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        images.push(...(await extractImagesFromPage(page, pdfjs)));
      }
      return images;
    },
  };
}
