export type QrRasterImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type QrDecodeInput =
  | { kind: "encoded"; bytes: Uint8Array }
  | { kind: "rgba"; image: QrRasterImage };

export type QrReadOptions = {
  /**
   * Keep retrying until the codes found satisfy this. Defaults to "found any".
   * A Slovnaft receipt's intact marketing QR must not stop the retries that
   * would recover its print-damaged eKasa QR.
   */
  until?: (codes: readonly string[]) => boolean;
};

export type QrReader = {
  readAllCodes(input: QrDecodeInput, options?: QrReadOptions): Promise<string[]>;
};
