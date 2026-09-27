export type QrRasterImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type QrDecodeInput =
  | { kind: "encoded"; bytes: Uint8Array }
  | { kind: "rgba"; image: QrRasterImage };

export type QrReader = {
  readAllCodes(input: QrDecodeInput): Promise<string[]>;
};
