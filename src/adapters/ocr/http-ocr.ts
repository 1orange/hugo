import type { PdfPageImage } from "../pdf/port";
import type { Ocr, OcrBox, OcrInput, OcrOutput } from "./port";

export const OCR_USER_AGENT = "hugo-accounting/0.1";

type FetchLike = typeof fetch;

type HttpOcrBox = {
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  page?: number;
};

type HttpOcrResponse = {
  boxes?: HttpOcrBox[];
};

function imageToWire(image: PdfPageImage): Record<string, unknown> {
  if (image.kind === "encoded") {
    return {
      kind: "encoded",
      data: Buffer.from(image.bytes).toString("base64"),
    };
  }
  return {
    kind: "rgba",
    data: Buffer.from(image.data).toString("base64"),
    width: image.width,
    height: image.height,
  };
}

export type HttpOcrOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
};

function ocrUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/ocr") ? trimmed : `${trimmed}/ocr`;
}

export function createHttpOcr(options: HttpOcrOptions): Ocr {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = ocrUrl(options.baseUrl);

  return {
    async recognize(input: OcrInput): Promise<OcrOutput> {
      const started = Date.now();
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": OCR_USER_AGENT,
        },
        body: JSON.stringify({
          images: input.images.map(imageToWire),
        }),
      });

      if (!response.ok) {
        throw new Error(`OCR HTTP ${response.status}`);
      }

      const raw: unknown = await response.json();
      const body = raw as HttpOcrResponse;
      const boxes = (body.boxes ?? [])
        .map((box) => {
          const mapped: OcrBox = {
            text: typeof box.text === "string" ? box.text : "",
            x: typeof box.x === "number" ? box.x : 0,
            y: typeof box.y === "number" ? box.y : 0,
          };
          if (typeof box.width === "number") mapped.width = box.width;
          if (typeof box.height === "number") mapped.height = box.height;
          if (typeof box.page === "number") mapped.page = box.page;
          return mapped;
        })
        .filter((box) => box.text.length > 0);

      return {
        boxes,
        durationMs: Date.now() - started,
      };
    },
  };
}
