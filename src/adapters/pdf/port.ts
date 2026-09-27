export type PdfTextLine = string;

export type PdfPageImage =
  | { kind: "encoded"; bytes: Uint8Array }
  | {
      kind: "rgba";
      data: Uint8ClampedArray;
      width: number;
      height: number;
    };

export type PdfAccess = {
  extractTextLines(
    pdfBytes: Uint8Array,
    options?: { password?: string; pageNumber?: number },
  ): Promise<PdfTextLine[]>;
  extractPageImages(pdfBytes: Uint8Array): Promise<PdfPageImage[]>;
};
