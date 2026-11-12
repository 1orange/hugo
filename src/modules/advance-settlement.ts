import { cashRoundingCents } from "./cash-rounding";
import type {
  AdvanceSettlementPayload,
  DocumentVatRecapRow,
  ModelExtractedPayload,
} from "./document-payload";
import { parseSignedDecimalAmount } from "./money";

/**
 * An invoice settled by an advance — a *zálohové (preddavkové) faktúry* — is
 * booked at the value of its supply, not at the amount due (ADR 0017
 * amendment, 2026-11-11). Deterministic, on the text lines, after the model.
 *
 * Detection needs a deduction label anywhere in the text AND evidence that an
 * advance was deducted: a settlement recap row, or a printed amount of the
 * advance used. A deduction label alone, a zero total or a credit note is not
 * a settlement.
 */

export type SettlementAmount = { cents: number; literal: string };

export type SettlementTotal = SettlementAmount & {
  provenance: "extracted" | "derived";
};

export type AdvanceSettlementInput = {
  lines: readonly string[];
  /** The model's total: the amount due on a settled invoice, or the total on a plain one. */
  total: { cents: number; literal: string } | null;
  vatRecap: readonly DocumentVatRecapRow[];
  /** Cash rounding follows the currency (cash-rounding module). Defaults to EUR. */
  currency?: string;
};

export type AdvanceSettlementResult =
  | { settled: false }
  | {
      settled: true;
      total: SettlementTotal;
      supplyRows: DocumentVatRecapRow[];
      settlementRows: DocumentVatRecapRow[];
      advanceDeducted: SettlementAmount;
      amountDue: SettlementAmount;
      advanceDocumentNumbers: string[];
      /**
       * Set when the printed amount due does not follow from total − advance
       * (within cash rounding): a misread advance, flagged, never corrected.
       */
      identityWarning: string | null;
      /** What she should look at, in Slovak; the invoice is still settled. */
      findings: string[];
    };

const NOT_SETTLED: AdvanceSettlementResult = { settled: false };

/**
 * The words that mark a deduction, folded for case and diacritics:
 * `Zál. daň. dokl.`, `zálohové doklady`, `Odpočet zálohy`, `uhradené zálohou`,
 * `celkom uhradených záloh`, `zálohy celkom`, `záloha`, `preddavok`.
 */
const DEDUCTION_MARKER = /zal\.?\s*dan\.?\s*dokl|zaloh|preddavk/;
/** The advance used, printed as an amount on its own line. */
const PRINTED_ADVANCE = /uhra[dz]en\w*\s+zaloh|zalohy\s+celkom/;
/** A line that prints the gross total. */
const PRINTED_GROSS = /^(celkom|celkem)\b|celkova hodnota plnenia/;
const AMOUNT = /-?\d{1,3}(?:[\s ]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;
const RATE = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/;
const ADVANCE_DOCUMENT = /\bZDD\s?(\d{5,})\b/gi;

/** Folded for matching: no diacritics, lower case. */
export function foldForMatch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Every amount printed on a line, in the order it is printed. */
function amountsIn(line: string): SettlementAmount[] {
  return [...line.matchAll(AMOUNT)].flatMap((match) => {
    const parsed = parseSignedDecimalAmount(match[0].replace(/[\s ]/g, ""));
    return "ok" in parsed ? [] : [{ cents: parsed.cents, literal: formatCents(parsed.cents) }];
  });
}

function rateOfLiteral(literal: string): number | null {
  const trimmed = literal.trim();
  if (!/^-?\d+(?:[.,]\d+)?%?$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed.replace(/%$/, "").replace(",", "."));
}

function rowOf(rate: number, base: SettlementAmount, vat: SettlementAmount): DocumentVatRecapRow {
  return {
    rateLiteral: String(rate),
    baseLiteral: base.literal,
    baseCents: base.cents,
    vatLiteral: vat.literal,
    vatCents: vat.cents,
  };
}

function copyRow(row: DocumentVatRecapRow): DocumentVatRecapRow {
  return {
    rateLiteral: row.rateLiteral,
    baseLiteral: row.baseLiteral,
    baseCents: row.baseCents,
    vatLiteral: row.vatLiteral,
    vatCents: row.vatCents,
  };
}

function sameRow(text: DocumentVatRecapRow, model: DocumentVatRecapRow): boolean {
  const textRate = rateOfLiteral(text.rateLiteral);
  return (
    textRate !== null &&
    textRate === rateOfLiteral(model.rateLiteral) &&
    text.baseCents === model.baseCents &&
    text.vatCents === model.vatCents
  );
}

function sum(rows: readonly DocumentVatRecapRow[], value: (row: DocumentVatRecapRow) => number): number {
  return rows.reduce((total, row) => total + value(row), 0);
}

/**
 * The recap rows that deduct the advance, read off the text: a line with a
 * deduction marker, a rate, and two amounts (base, VAT).
 */
function textSettlementRows(lines: readonly string[], folded: readonly string[]): DocumentVatRecapRow[] {
  const rows: DocumentVatRecapRow[] = [];
  lines.forEach((line, index) => {
    if (!DEDUCTION_MARKER.test(folded[index]!)) {
      return;
    }
    const rate = RATE.exec(line);
    const amounts = amountsIn(line);
    if (!rate || amounts.length < 2) {
      return;
    }
    rows.push(rowOf(Number(rate[1]!.replace(",", ".")), amounts[0]!, amounts[1]!));
  });
  return rows;
}

/**
 * Splits the model's recap. A row the text shows as a deduction, and any
 * negative row (a recap of supply is never negative once a deduction is
 * printed; a credit note has no deduction label), is a settlement row. The rest
 * is the supply.
 */
function splitRecap(
  vatRecap: readonly DocumentVatRecapRow[],
  textRows: readonly DocumentVatRecapRow[],
): { settlementRows: DocumentVatRecapRow[]; supplyRows: DocumentVatRecapRow[] } {
  const unmatched = [...textRows];
  const settlementRows: DocumentVatRecapRow[] = [];
  const supplyRows: DocumentVatRecapRow[] = [];
  for (const row of vatRecap) {
    const index = unmatched.findIndex((text) => sameRow(text, row));
    if (index >= 0) {
      unmatched.splice(index, 1);
      settlementRows.push(copyRow(row));
    } else if (row.baseCents < 0 || row.vatCents < 0) {
      settlementRows.push(copyRow(row));
    } else {
      supplyRows.push(copyRow(row));
    }
  }
  // A deduction the model did not return is still a deduction, for audit.
  settlementRows.push(...unmatched);
  return { settlementRows, supplyRows };
}

function uniqueRows(rows: readonly DocumentVatRecapRow[]): DocumentVatRecapRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${rateOfLiteral(row.rateLiteral)}|${row.baseCents}|${row.vatCents}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** The first amount on the first line matching the pattern, if any. */
function firstAmountOf(
  lines: readonly string[],
  folded: readonly string[],
  pattern: RegExp,
): SettlementAmount | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!pattern.test(folded[index]!)) {
      continue;
    }
    const amount = amountsIn(lines[index]!)[0];
    if (amount) {
      return amount;
    }
  }
  return null;
}

/** Amounts on the lines that print a gross total (`Celkom`, `Celková hodnota plnenia`). */
function printedGrossAmounts(lines: readonly string[], folded: readonly string[]): SettlementAmount[] {
  return lines.flatMap((line, index) =>
    PRINTED_GROSS.test(folded[index]!.trim()) ? amountsIn(line) : [],
  );
}

function advanceDocumentNumbers(lines: readonly string[], folded: readonly string[]): string[] {
  const numbers: string[] = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(ADVANCE_DOCUMENT)) {
      numbers.push(`ZDD${match[1]}`);
    }
    if (/zalohov\w*\s+doklad\w*/.test(folded[index]!)) {
      const numbered = /(?:č|c)\.\s*:?\s*(\d{5,})/i.exec(line);
      if (numbered) {
        numbers.push(numbered[1]!);
      }
    }
  });
  return [...new Set(numbers)];
}

/** The amount due printed on the invoice, when the model's total is one (it is a printed amount, not the supply). */
function printedDueOf(
  input: AdvanceSettlementInput,
  printed: ReadonlySet<number>,
  totalCents: number,
): SettlementAmount | null {
  const due = input.total;
  if (!due || due.cents === totalCents || !printed.has(due.cents)) {
    return null;
  }
  return { cents: due.cents, literal: due.literal };
}

export function settleAdvance(input: AdvanceSettlementInput): AdvanceSettlementResult {
  const { lines } = input;
  const currency = input.currency ?? "EUR";
  const folded = lines.map(foldForMatch);
  if (!folded.some((line) => DEDUCTION_MARKER.test(line))) {
    return NOT_SETTLED;
  }

  const textRows = uniqueRows(textSettlementRows(lines, folded));
  const split = splitRecap(input.vatRecap, textRows);
  const supplyRows = split.supplyRows.filter((row) => row.baseCents !== 0 || row.vatCents !== 0);
  const hasSupply = supplyRows.length > 0;
  const supplyCents = sum(supplyRows, (row) => row.baseCents + row.vatCents);

  // A total is taken only from amounts printed in the text.
  const printed = new Set(lines.flatMap(amountsIn).map((amount) => amount.cents));
  const modelTotal =
    input.total && input.total.cents !== 0 && printed.has(input.total.cents)
      ? { cents: input.total.cents, literal: formatCents(input.total.cents) }
      : null;

  const printedAdvance = firstAmountOf(lines, folded, PRINTED_ADVANCE);
  const rowsAdvance =
    split.settlementRows.length > 0 ? Math.abs(sum(split.settlementRows, (row) => row.baseCents + row.vatCents)) : null;
  const advanceCents =
    printedAdvance && printedAdvance.cents !== 0 ? Math.abs(printedAdvance.cents) : rowsAdvance;
  if (!advanceCents) {
    // A deduction label without a deducted amount is not a settlement.
    return NOT_SETTLED;
  }

  let total: SettlementTotal;
  if (hasSupply) {
    const candidates = [...(modelTotal ? [modelTotal] : []), ...printedGrossAmounts(lines, folded)];
    const matching = candidates.find(
      (candidate) =>
        candidate.cents !== 0 &&
        cashRoundingCents({ itemsTotalCents: supplyCents, payableCents: candidate.cents, currency }) !== null,
    );
    total = matching
      ? { cents: matching.cents, literal: formatCents(matching.cents), provenance: "extracted" }
      : { cents: supplyCents, literal: formatCents(supplyCents), provenance: "derived" };
  } else {
    // Without supply rows only a printed, positive total can stand for the supply.
    if (!modelTotal || modelTotal.cents <= 0) {
      return NOT_SETTLED;
    }
    total = { ...modelTotal, provenance: "extracted" };
  }

  const amountDueCents = total.cents - advanceCents;
  // total − advance = amount due, as an informational identity (ADR 0017 amendment).
  const printedDue = printedDueOf(input, printed, total.cents);
  const identityHolds =
    printedDue === null ||
    cashRoundingCents({
      itemsTotalCents: amountDueCents,
      payableCents: printedDue.cents,
      currency,
    }) !== null;
  const identityWarning = identityHolds
    ? null
    : `Odpočet zálohy nesedí: celkom − záloha ≠ k úhrade (${total.literal} − ${formatCents(advanceCents)} = ${formatCents(amountDueCents)}, na doklade ${printedDue!.literal}).`;
  const findings: string[] = [];
  // A total that is the printed amount due is judged by the identity, not as a mismatch.
  if (input.total && input.total.cents !== 0 && input.total.cents !== total.cents && printedDue === null) {
    findings.push(
      `Suma na doklade ${input.total.literal} sa nezhoduje so súčtom základu a DPH (${total.literal}); účtuje sa súčet.`,
    );
  }
  if (printedAdvance && rowsAdvance !== null && Math.abs(printedAdvance.cents) !== rowsAdvance) {
    findings.push(
      `Odpočet zálohy z riadkov DPH (${formatCents(rowsAdvance)}) sa nezhoduje s uvedenou sumou (${printedAdvance.literal}).`,
    );
  }
  if (amountDueCents < 0) {
    findings.push("Odpočet zálohy je vyšší než celková suma.");
  }

  return {
    settled: true,
    total,
    supplyRows,
    settlementRows: uniqueRows(split.settlementRows),
    advanceDeducted: { cents: advanceCents, literal: formatCents(advanceCents) },
    amountDue: { cents: amountDueCents, literal: formatCents(amountDueCents) },
    advanceDocumentNumbers: advanceDocumentNumbers(lines, folded),
    identityWarning,
    findings,
  };
}

/**
 * The payload with a settlement applied: the amount and VAT recap become the
 * supply, and the deduction is kept beside them, with the amounts as read.
 */
function withAdvanceSettlement(
  payload: ModelExtractedPayload,
  result: Extract<AdvanceSettlementResult, { settled: true }>,
  source: AdvanceSettlementPayload["source"],
): ModelExtractedPayload {
  const advanceSettlement: AdvanceSettlementPayload = {
    source,
    totalProvenance: result.total.provenance,
    advanceDeductedCents: result.advanceDeducted.cents,
    advanceDeductedLiteral: result.advanceDeducted.literal,
    amountDueCents: result.amountDue.cents,
    amountDueLiteral: result.amountDue.literal,
    advanceDocumentNumbers: result.advanceDocumentNumbers,
    settlementRows: result.settlementRows,
    originalAmountCents: payload.amountCents,
    originalAmountLiteral: payload.amountLiteral,
    originalVatRecap: payload.vatRecap.map(copyRow),
    identityWarning: result.identityWarning,
    findings: result.findings,
  };
  return {
    ...payload,
    amountCents: result.total.cents,
    amountLiteral: result.total.literal,
    vatRecap: result.supplyRows,
    advanceSettlement,
  };
}

/**
 * Applies a settlement detected on the text lines to an extracted invoice. An
 * invoice that is not settled comes back unchanged.
 */
export function applyAdvanceSettlement(
  payload: ModelExtractedPayload,
  lines: readonly string[],
): ModelExtractedPayload {
  const result = settleAdvance({
    lines,
    total: payload.amountCents === null ? null : { cents: payload.amountCents, literal: payload.amountLiteral ?? "" },
    vatRecap: payload.vatRecap,
    currency: payload.currency,
  });
  if (!result.settled) {
    return payload;
  }
  return withAdvanceSettlement(payload, result, "detected");
}

/**
 * The same settlement read off the stored payload, for an invoice the text did
 * not settle but she marked settled: negative recap rows are the deduction, the
 * supply is the rest, and the advance is what the rows or the printed amount
 * due leave. No text is needed, so there is no identity to check. Null when
 * the payload shows no deduction to take: no supply, or nothing deducted.
 */
export function settleFromPayload(payload: ModelExtractedPayload): ModelExtractedPayload | null {
  const rows = payload.vatRecap.filter((row) => row.baseCents !== 0 || row.vatCents !== 0);
  const isDeduction = (row: DocumentVatRecapRow) => row.baseCents < 0 || row.vatCents < 0;
  const settlementRows = rows.filter(isDeduction).map(copyRow);
  const supplyRows = rows.filter((row) => !isDeduction(row)).map(copyRow);
  if (supplyRows.length === 0) {
    return null;
  }
  const supplyCents = sum(supplyRows, (row) => row.baseCents + row.vatCents);
  if (supplyCents <= 0) {
    return null;
  }
  const advanceCents =
    settlementRows.length > 0
      ? Math.abs(sum(settlementRows, (row) => row.baseCents + row.vatCents))
      : payload.amountCents === null
        ? null
        : supplyCents - payload.amountCents;
  if (advanceCents === null || advanceCents <= 0) {
    return null;
  }
  const amountDueCents = supplyCents - advanceCents;
  return withAdvanceSettlement(
    payload,
    {
      settled: true,
      total: { cents: supplyCents, literal: formatCents(supplyCents), provenance: "derived" },
      supplyRows,
      settlementRows,
      advanceDeducted: { cents: advanceCents, literal: formatCents(advanceCents) },
      amountDue: { cents: amountDueCents, literal: formatCents(amountDueCents) },
      advanceDocumentNumbers: [],
      identityWarning: null,
      findings: [],
    },
    "manual",
  );
}

/**
 * The plain extraction of an invoice whose settlement is set aside: the amount
 * and recap as the model read them, and no settlement. For an invoice stored
 * before the amounts as read were kept, what the payload has is restored.
 */
export function restorePlainExtraction(payload: ModelExtractedPayload): ModelExtractedPayload {
  const block = payload.advanceSettlement;
  if (!block) {
    return payload;
  }
  const plain: ModelExtractedPayload = { ...payload };
  delete plain.advanceSettlement;
  return {
    ...plain,
    amountCents: block.originalAmountCents !== undefined ? block.originalAmountCents : block.amountDueCents,
    amountLiteral: block.originalAmountLiteral !== undefined ? block.originalAmountLiteral : block.amountDueLiteral,
    vatRecap: block.originalVatRecap ? block.originalVatRecap.map(copyRow) : [...payload.vatRecap, ...block.settlementRows],
  };
}

/**
 * The extraction as she decided it: `settled` is her manual flag, or undefined
 * when she has made none, in which case the detection stands. A flag that
 * cannot be applied to the payload leaves it as it is.
 */
export function applyAdvanceOverride(
  payload: ModelExtractedPayload,
  settled: boolean | undefined,
): ModelExtractedPayload {
  if (settled === undefined) {
    return payload;
  }
  if (!settled) {
    return restorePlainExtraction(payload);
  }
  if (payload.advanceSettlement) {
    return { ...payload, advanceSettlement: { ...payload.advanceSettlement, source: "manual" } };
  }
  return settleFromPayload(payload) ?? payload;
}
