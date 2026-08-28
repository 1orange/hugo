export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type PdfAccess = {
  extractEmbeddedImages(
    pdfBytes: Uint8Array,
    options?: { password?: string },
  ): Promise<RgbaImage[]>;
  renderPage(
    pdfBytes: Uint8Array,
    options?: { password?: string; pageNumber?: number; scale?: number },
  ): Promise<RgbaImage>;
};

export type QrDecoder = {
  decodeFromImage(image: RgbaImage): Promise<string | null>;
};
