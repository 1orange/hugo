import type { PdfPageImage } from "../pdf/port";

export type OcrBox = {
  text: string;
  x: number;
  y: number;
};

export type OcrInput = {
  images: readonly PdfPageImage[];
};

export type OcrOutput = {
  boxes: OcrBox[];
  durationMs: number;
};

export type Ocr = {
  recognize(input: OcrInput): Promise<OcrOutput>;
};
