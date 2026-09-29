/**
 * Deterministic clean-up of what the model returns, before the checks run.
 *
 * Small models answer in the document's own conventions rather than the ones
 * asked for — Qwen3 0.6B wrote `26.05.2026` for dates and `€` for the currency
 * — and they put the wrong kind of text into a field: a company name as the
 * IČO, a sentence as the variabilný symbol. Formats with a fixed shape are
 * normalised here; a value that cannot have that shape is dropped, so the
 * field ends empty instead of wrong.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRINTED_DATE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/;

export function normalizeModelDate(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO_DATE.exec(trimmed);
  const printed = PRINTED_DATE.exec(trimmed);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (printed) {
    [day, month, year] = [Number(printed[1]), Number(printed[2]), Number(printed[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const CURRENCY_ALIASES: Record<string, string> = {
  "€": "EUR",
  EURO: "EUR",
  KČ: "CZK",
  KC: "CZK",
};

export function normalizeModelCurrency(value: string | null | undefined): string {
  const upper = (value ?? "").trim().toUpperCase();
  if (upper.length === 0) {
    return "EUR";
  }
  return CURRENCY_ALIASES[upper] ?? upper;
}

/** Slovak and Czech IČO: eight digits. */
export function normalizeModelIco(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\s/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

/** Variabilný symbol: up to ten digits. */
export function normalizeModelVariableSymbol(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\s/g, "");
  return /^\d{1,10}$/.test(digits) ? digits : null;
}

// The label printed before a tax number, which the model sometimes keeps —
// from OCR text, `ICDPH|SK2121428375`.
const TAX_NUMBER_LABEL = /^(i[čc]\s*dph|di[čc]|vat(\s*(id|no\.?|number))?)\s*[:|.\-]*\s*/i;

function compactTaxNumber(value: string | null | undefined): string | null {
  const compact = (value ?? "")
    .trim()
    .replace(TAX_NUMBER_LABEL, "")
    .replace(/[\s.\-/]/g, "")
    .toUpperCase();
  return compact.length > 0 ? compact : null;
}

// What the model put in a tax number field on her documents, and was not
// one: a Polish waste-register number ("BDO 000012345"), a phone number, a car's
// plate, an IBAN.
//
// IČ DPH: a VAT number — an EU country's prefix, then its national number;
// Slovak and Czech ones checked for length.
// An EU VAT number has six digits or more; "PLATBA" is not a Polish one.
const VAT_NUMBER =
  /^(?:SK\d{10}|CZ\d{8,10}|(?:AT|BE|BG|CY|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|NO|PL|PT|RO|SE|SI|XI)(?=(?:[A-Z]*\d){6})[0-9A-Z]{2,13})$/;
// DIČ: a Slovak one is ten digits, a Czech one is its VAT number; other
// countries' tax numbers are digits too (a Polish NIP, 123-456-78-90).
const TAX_NUMBER = /^(?:\d{8,13}|CZ\d{8,10})$/;

export function normalizeModelIcDph(value: string | null | undefined): string | null {
  const compact = compactTaxNumber(value);
  return compact && VAT_NUMBER.test(compact) ? compact : null;
}

export function normalizeModelDic(value: string | null | undefined): string | null {
  const compact = compactTaxNumber(value);
  return compact && TAX_NUMBER.test(compact) ? compact : null;
}

/**
 * A party's DIČ and IČ DPH, each where it belongs. MODIVO prints its Slovak
 * VAT number as "DIČ: SK4120004493": a Slovak DIČ never has the prefix, so it
 * is the IČ DPH. A bare ten digits in the IČ DPH field is a DIČ.
 */
export function normalizeModelTaxNumbers(party: {
  dic: string | null | undefined;
  icDph: string | null | undefined;
}): { dic: string | null; icDph: string | null } {
  let dic = normalizeModelDic(party.dic);
  let icDph = normalizeModelIcDph(party.icDph);
  const dicAsVat = dic === null ? normalizeModelIcDph(party.dic) : null;
  if (dicAsVat && !dicAsVat.startsWith("CZ")) {
    icDph ??= dicAsVat;
  }
  const vatAsDic = icDph === null ? normalizeModelDic(party.icDph) : null;
  if (vatAsDic && /^\d+$/.test(vatAsDic)) {
    dic ??= vatAsDic;
  }
  return { dic, icDph };
}

// The words printed before the number: `Faktúra - daňový doklad - 5420373176`,
// `Faktúra č. 1792929-SK1126-680675`.
const DOCUMENT_NUMBER_LABEL =
  /^(fakt[úu]ra|da[ňn]ov[ýy]\s+doklad|doklad|[čc][íi]slo|[čc]\.|invoice(\s+(no\.?|number))?|no\.)\s*[:\-–|.]*\s*/i;

/** The number without the label printed before it; a label alone is not a number. */
export function normalizeModelDocumentNumber(value: string | null | undefined): string | null {
  let rest = (value ?? "").trim();
  for (let previous = ""; previous !== rest; ) {
    previous = rest;
    rest = rest.replace(DOCUMENT_NUMBER_LABEL, "").trim();
  }
  return /\d/.test(rest) ? rest : null;
}

// Section headings the model returns as a company's name.
const PARTY_HEADING =
  /^(dod[áa]vate[ľl]|odberate[ľl]|pr[íi]jemca|kupuj[úu]ci|pred[áa]vaj[úu]ci|supplier|customer|seller|buyer)\s*:?$/i;

export function normalizeModelPartyName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 || PARTY_HEADING.test(trimmed) ? null : trimmed;
}

/**
 * The amount without the currency and the spaces that group thousands:
 * `563,96 EUR` → `563,96`, `1 180,12 €` → `1180,12`. A mixed-separator amount
 * such as `1.180,12` is left for the parser to reject, not guessed at.
 */
export function normalizeModelAmountLiteral(value: string | null | undefined): string | null {
  const stripped = (value ?? "").replace(/EUR|CZK|Kč|€/gi, "").replace(/[\s\u00a0]/g, "");
  return stripped.length > 0 ? stripped : null;
}
