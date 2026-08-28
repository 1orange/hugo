import type { PdfAccess, RgbaImage } from "./port";

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

function imageDataToRgba(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}): RgbaImage {
  return {
    width: image.width,
    height: image.height,
    data:
      image.data instanceof Uint8ClampedArray
        ? image.data
        : new Uint8ClampedArray(image.data),
  };
}

export function createPdfAccess(): PdfAccess {
  return {
    async extractEmbeddedImages(pdfBytes, options) {
      const pdfjs = await loadPdfJs();
      const doc = await openDocument(pdfBytes, options?.password);
      const images: RgbaImage[] = [];

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const ops = await page.getOperatorList();
        const { OPS } = pdfjs;

        for (let index = 0; index < ops.fnArray.length; index += 1) {
          const fn = ops.fnArray[index];
          if (
            fn !== OPS.paintImageXObject &&
            fn !== OPS.paintInlineImageXObject
          ) {
            continue;
          }

          const arg = ops.argsArray[index];
          if (fn === OPS.paintInlineImageXObject && arg) {
            images.push(
              imageDataToRgba({
                width: arg.width,
                height: arg.height,
                data: arg.data ?? arg.bitmap?.data,
              }),
            );
            continue;
          }

          if (typeof arg === "string") {
            const bitmap = await new Promise<{
              width: number;
              height: number;
              data: Uint8ClampedArray;
            } | null>((resolve) => {
              page.objs.get(arg, (value: { bitmap?: { width: number; height: number; data: Uint8ClampedArray } }) => {
                resolve(value?.bitmap ?? null);
              });
            });
            if (bitmap) {
              images.push(imageDataToRgba(bitmap));
            }
          }
        }
      }

      return images;
    },

    async renderPage(pdfBytes, options) {
      const { createCanvas } = await import("@napi-rs/canvas");
      const doc = await openDocument(pdfBytes, options?.password);
      const pageNumber = options?.pageNumber ?? 1;
      const scale = options?.scale ?? 3;
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;

      const imageData = context.getImageData(0, 0, viewport.width, viewport.height);
      return imageDataToRgba(imageData);
    },
  };
}
