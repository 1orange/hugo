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
    options?: {
      password?: string;
      /** One page; the first when neither this nor maxPages is given. */
      pageNumber?: number;
      /** Pages 1…maxPages (or all, if fewer), their lines in reading order. */
      maxPages?: number;
    },
  ): Promise<PdfTextLine[]>;
  extractPageImages(pdfBytes: Uint8Array): Promise<PdfPageImage[]>;
};
