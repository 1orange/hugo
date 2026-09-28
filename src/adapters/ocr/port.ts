import type { PdfPageImage } from "../pdf/port";

/** A recognised piece of text, in the image's pixels with y growing downwards. */
export type OcrBox = {
  text: string;
  /** Top-left corner. */
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Which of the input images (pages) it is on; 0 when absent. */
  page?: number;
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
