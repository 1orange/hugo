export const EKASA_UID_PATTERN = /^[OV]-[0-9A-Fa-f]{32}$/;
export const EKASA_OKP_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}$/;

export function isValidEkasaUid(value: string): boolean {
  return EKASA_UID_PATTERN.test(value.trim());
}

export function isValidEkasaOkp(value: string): boolean {
  return EKASA_OKP_PATTERN.test(value.trim());
}
