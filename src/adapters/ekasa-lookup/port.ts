export type EkasaLookupSuccess = {
  ok: true;
  raw: unknown;
};

export type EkasaLookupFailure = {
  ok: false;
  reason: string;
};

export type EkasaLookupResult = EkasaLookupSuccess | EkasaLookupFailure;

export type EkasaLookup = {
  findReceipt(receiptId: string): Promise<EkasaLookupResult>;
};
