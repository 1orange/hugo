export type PdfTextLine = string;

export type PdfAccess = {
  extractTextLines(
    pdfBytes: Uint8Array,
    options?: { password?: string; pageNumber?: number },
  ): Promise<PdfTextLine[]>;
};
