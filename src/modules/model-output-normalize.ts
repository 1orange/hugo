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
  const compact = (value ?? "").trim().replace(TAX_NUMBER_LABEL, "").replace(/\s/g, "").toUpperCase();
  return compact.length > 0 ? compact : null;
}

export function normalizeModelIcDph(value: string | null | undefined): string | null {
  return compactTaxNumber(value);
}

export function normalizeModelDic(value: string | null | undefined): string | null {
  return compactTaxNumber(value);
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
