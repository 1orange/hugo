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
      /**
       * "rows" (default): each line is everything at one height, as the
       * receipt parser and the VAT register import read it. "reading": block
       * by block, a column at a time, for the model (reading-order module).
       */
      order?: "rows" | "reading";
    },
  ): Promise<PdfTextLine[]>;
  extractPageImages(pdfBytes: Uint8Array): Promise<PdfPageImage[]>;
};
