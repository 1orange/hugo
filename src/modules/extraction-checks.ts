import type { CompanyCountry } from "./company-profile";
import { validateSkIcDph } from "./company-profile";
import type { FieldCheckState } from "./document-fields";
import { checkArithmeticWarnings, mergeDocumentFields } from "./document-fields";
import { cashRoundingCents } from "./cash-rounding";
import { parseSignedDecimalAmount } from "./money";
import type {
  DocumentParty,
  DocumentVatRecapRow,
  ModelExtractedPayload,
} from "./document-payload";
import { parseMonthKey } from "./format-sk";
import { isLabelledOnlyAsDue, labelledDates } from "./labelled-dates";

export type ExtractionChecksInput = {
  payload: ModelExtractedPayload;
  sourceTextLines: string[];
  monthKey: string;
  issuerCountry?: CompanyCountry | null;
};

export type PartyFieldCheckStates = {
  name: FieldCheckState;
  ico: FieldCheckState;
  dic: FieldCheckState;
  icDph: FieldCheckState;
};

export type ExtractionCheckFlags = {
  documentNumber: FieldCheckState;
  variableSymbol: FieldCheckState;
  issueDate: FieldCheckState;
  taxableSupplyDate: FieldCheckState;
  dueDate: FieldCheckState;
  currency: FieldCheckState;
  amountCents: FieldCheckState;
  vatRecap: FieldCheckState;
  parties: PartyFieldCheckStates[];
};

export type ExtractionChecksResult = {
  payload: ModelExtractedPayload;
  flags: ExtractionCheckFlags;
};

const SK_VAT_RATES = new Set([23, 19, 5, 0]);
const CZ_VAT_RATES = new Set([21, 12, 0]);

const CZ_VAT_ID = /^CZ(\d{8,10})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizedHaystack(lines: readonly string[]): string {
  return lines.join("\n").replace(/\s+/g, "");
}

function isGrounded(value: string | null | undefined, haystack: string): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return true;
  }
  return haystack.includes(trimmed.replace(/\s+/g, ""));
}

function computeIcoCheckDigit(firstSeven: string): number | null {
  if (!/^\d{7}$/.test(firstSeven)) {
    return null;
  }
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(firstSeven[i]) * weights[i]!;
  }
  const remainder = sum % 11;
  if (remainder === 0) {
    return 1;
  }
  if (remainder === 1) {
    return null;
  }
  return 11 - remainder;
}

export function isValidIcoChecksum(ico: string): boolean {
  const digits = ico.replace(/\s/g, "");
  if (!/^\d{8}$/.test(digits)) {
    return false;
  }
  const expected = computeIcoCheckDigit(digits.slice(0, 7));
  if (expected === null) {
    return false;
  }
  return Number(digits[7]) === expected;
}

function isValidCzVatId(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  const match = CZ_VAT_ID.exec(trimmed);
  if (!match) {
    return false;
  }
  const body = match[1]!;
  if (body.length === 8) {
    return isValidIcoChecksum(body);
  }
  return /^\d{10}$/.test(body);
}

function parseRatePercent(rateLiteral: string): number | null {
  const cleaned = rateLiteral.trim().replace(/%$/, "").replace(",", ".");
  if (cleaned.length === 0) {
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function vatRateAllowed(country: CompanyCountry, rate: number): boolean {
  const allowed = country === "CZ" ? CZ_VAT_RATES : SK_VAT_RATES;
  return allowed.has(rate);
}

function inferIssuerCountry(parties: DocumentParty[]): CompanyCountry | null {
  for (const party of parties) {
    const vat = (party.icDph ?? "").trim().toUpperCase();
    if (vat.startsWith("CZ")) {
      return "CZ";
    }
    if (vat.startsWith("SK")) {
      return "SK";
    }
  }
  return null;
}

function monthDistance(monthKey: string, isoDate: string): number | null {
  const folder = parseMonthKey(monthKey);
  const match = ISO_DATE.exec(isoDate.trim());
  if (!folder || !match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return Math.abs((folder.year - year) * 12 + (folder.month - month));
}

function datePlausible(monthKey: string, isoDate: string | null): boolean {
  if (!isoDate) {
    return true;
  }
  const distance = monthDistance(monthKey, isoDate);
  if (distance === null) {
    return false;
  }
  return distance <= 1;
}

function perRowVatMatchesRate(row: DocumentVatRecapRow): boolean {
  const rate = parseRatePercent(row.rateLiteral);
  if (rate === null) {
    return false;
  }
  const expectedVat = Math.round((row.baseCents * rate) / 100);
  return Math.abs(expectedVat - row.vatCents) <= 1;
}

// A literal the parser could not read was mapped to 0 cents; that row must not
// pass as correct.
function recapLiteralsMatchCents(payload: ModelExtractedPayload): boolean {
  return payload.vatRecap.every((row) => {
    const base = parseSignedDecimalAmount(row.baseLiteral);
    const vat = parseSignedDecimalAmount(row.vatLiteral);
    return !("ok" in base) && base.cents === row.baseCents && !("ok" in vat) && vat.cents === row.vatCents;
  });
}

function recapArithmeticOk(payload: ModelExtractedPayload): boolean {
  if (payload.vatRecap.length === 0) {
    return true;
  }
  // Each row's VAT must fit its rate, whether or not the total was read.
  if (!payload.vatRecap.every(perRowVatMatchesRate)) {
    return false;
  }
  if (payload.amountCents === null) {
    return true;
  }
  let baseSum = 0;
  let vatSum = 0;
  for (const row of payload.vatRecap) {
    baseSum += row.baseCents;
    vatSum += row.vatCents;
  }
  const rounding = cashRoundingCents({
    itemsTotalCents: baseSum + vatSum,
    payableCents: payload.amountCents,
    currency: payload.currency,
  });
  return rounding !== null;
}

function vatRatesOk(
  payload: ModelExtractedPayload,
  issuerCountry: CompanyCountry,
): boolean {
  for (const row of payload.vatRecap) {
    const rate = parseRatePercent(row.rateLiteral);
    if (rate === null || !vatRateAllowed(issuerCountry, rate)) {
      return false;
    }
  }
  return true;
}

function mergeArithmeticFlags(payload: ModelExtractedPayload): boolean {
  const merged = mergeDocumentFields(payload, {});
  return checkArithmeticWarnings(merged.fields).length === 0;
}

function checkStateForValue(
  value: string | null | undefined,
  flagged: boolean,
): FieldCheckState {
  if ((value ?? "").trim().length === 0) {
    return "empty";
  }
  return flagged ? "flagged" : "correct";
}

function applyGroundingParty(
  party: DocumentParty,
  haystack: string,
): { party: DocumentParty; dropped: { ico: boolean; dic: boolean; icDph: boolean; documentFields: boolean } } {
  const next: DocumentParty = { ...party };
  const dropped = { ico: false, dic: false, icDph: false, documentFields: false };

  if (next.ico && !isGrounded(next.ico, haystack)) {
    next.ico = null;
    dropped.ico = true;
  }
  if (next.dic && !isGrounded(next.dic, haystack)) {
    next.dic = null;
    dropped.dic = true;
  }
  if (next.icDph && !isGrounded(next.icDph, haystack)) {
    next.icDph = null;
    dropped.icDph = true;
  }
  return { party: next, dropped };
}

function formatPartyFlags(
  party: DocumentParty,
  dropped: { ico: boolean; dic: boolean; icDph: boolean },
): PartyFieldCheckStates {
  const icoFlagged =
    !dropped.ico && party.ico !== null && !isValidIcoChecksum(party.ico);
  const icDph = (party.icDph ?? "").trim();
  let icDphFlagged = false;
  if (icDph.length > 0) {
    const upper = icDph.toUpperCase();
    if (upper.startsWith("SK")) {
      icDphFlagged = !validateSkIcDph(upper).ok;
    } else if (upper.startsWith("CZ")) {
      icDphFlagged = !isValidCzVatId(upper);
    } else {
      icDphFlagged = true;
    }
  }

  return {
    name: checkStateForValue(party.name, false),
    ico: dropped.ico
      ? "empty"
      : checkStateForValue(party.ico, icoFlagged),
    dic: dropped.dic ? "empty" : checkStateForValue(party.dic, false),
    icDph: dropped.icDph
      ? "empty"
      : checkStateForValue(party.icDph, icDphFlagged),
  };
}

export function runExtractionChecks(input: ExtractionChecksInput): ExtractionChecksResult {
  const haystack = normalizedHaystack(input.sourceTextLines);
  const issuerCountry =
    input.issuerCountry ?? inferIssuerCountry(input.payload.parties) ?? "SK";

  let documentNumber = input.payload.documentNumber;
  let variableSymbol = input.payload.variableSymbol;
  if (documentNumber && !isGrounded(documentNumber, haystack)) {
    documentNumber = null;
  }
  if (variableSymbol && !isGrounded(variableSymbol, haystack)) {
    variableSymbol = null;
  }

  const parties: DocumentParty[] = [];
  const partyFlags: PartyFieldCheckStates[] = [];
  for (const party of input.payload.parties) {
    const grounded = applyGroundingParty(party, haystack);
    parties.push(grounded.party);
    partyFlags.push(formatPartyFlags(grounded.party, grounded.dropped));
  }

  const payload: ModelExtractedPayload = {
    ...input.payload,
    documentNumber,
    variableSymbol,
    parties,
  };

  const arithmeticOk = recapArithmeticOk(payload) && mergeArithmeticFlags(payload);
  const ratesOk = payload.vatRecap.length === 0 || vatRatesOk(payload, issuerCountry);
  const recapLiteralsOk = recapLiteralsMatchCents(payload);

  // A date the document prints only as its due date is not its issue or
  // taxable supply date.
  const dateLabels = labelledDates(input.sourceTextLines);
  const issueDateFlagged =
    !datePlausible(input.monthKey, payload.issueDate) || isLabelledOnlyAsDue(payload.issueDate, dateLabels);
  const taxableFlagged =
    !datePlausible(input.monthKey, payload.taxableSupplyDate) ||
    isLabelledOnlyAsDue(payload.taxableSupplyDate, dateLabels);
  const dueFlagged = !datePlausible(input.monthKey, payload.dueDate);

  const flags: ExtractionCheckFlags = {
    documentNumber: checkStateForValue(
      documentNumber,
      documentNumber !== null && input.payload.documentNumber !== null && !isGrounded(input.payload.documentNumber, haystack),
    ),
    variableSymbol: checkStateForValue(
      variableSymbol,
      variableSymbol !== null && input.payload.variableSymbol !== null && !isGrounded(input.payload.variableSymbol, haystack),
    ),
    issueDate: checkStateForValue(payload.issueDate, issueDateFlagged),
    taxableSupplyDate: checkStateForValue(payload.taxableSupplyDate, taxableFlagged),
    dueDate: checkStateForValue(payload.dueDate, dueFlagged),
    currency: checkStateForValue(payload.currency, false),
    amountCents: checkStateForValue(
      payload.amountLiteral,
      !arithmeticOk && payload.amountCents !== null,
    ),
    vatRecap: checkStateForValue(
      payload.vatRecap.length > 0 ? "recap" : null,
      (!arithmeticOk || !ratesOk || !recapLiteralsOk) && payload.vatRecap.length > 0,
    ),
    parties: partyFlags,
  };

  if (documentNumber === null && input.payload.documentNumber) {
    flags.documentNumber = "empty";
  }
  if (variableSymbol === null && input.payload.variableSymbol) {
    flags.variableSymbol = "empty";
  }

  return { payload, flags };
}
