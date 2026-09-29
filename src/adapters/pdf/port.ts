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
  /**
   * Pages 1…maxPages drawn as a reader sees them, their long side
   * `longSidePx` — drawn text included, which extractPageImages misses. A
   * fake may leave it out; OCR then reads the page images only.
   */
  renderPages?(pdfBytes: Uint8Array, options: { maxPages: number; longSidePx: number }): Promise<PdfPageImage[]>;
  /** Files embedded in the PDF, such as the ISDOC invoice Omega attaches. */
  extractAttachments(pdfBytes: Uint8Array): Promise<PdfAttachment[]>;
};

export type PdfAttachment = { filename: string; content: Uint8Array };
