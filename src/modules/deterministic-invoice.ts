import type { DocumentParty, DocumentVatRecapRow, ModelExtractedPayload } from "./document-payload";
import { labelledDates, type DateLabel } from "./labelled-dates";
import { parseSignedDecimalAmount } from "./money";

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function unique(values: string[]): string | null {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0]! : null;
}

const MONEY = /(?<![\d.,])-?(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)[.,]\d{2}(?!\d)/g;
function amounts(line: string): Array<{ literal: string; cents: number }> {
  return [...line.matchAll(MONEY)].flatMap(([literal]) => {
    const parsed = parseSignedDecimalAmount(literal.replace(/[ \u00a0]/g, ""));
    return "ok" in parsed ? [] : [{ literal, cents: parsed.cents }];
  });
}

function labelledValue(lines: readonly string[], pattern: RegExp): string | null {
  const values: string[] = [];
  for (const line of lines) {
    const match = pattern.exec(fold(line));
    if (!match) continue;
    // Fold only the label; retain the original case of the identifier.
    const tail = line.slice(match.index + match[0].length).replace(/^[ :|]+/, "");
    const value = /^[A-Za-z0-9][A-Za-z0-9/_.-]*/.exec(tail)?.[0];
    if (value) values.push(value);
  }
  return unique(values);
}

function partiesFromBlocks(lines: readonly string[]): DocumentParty[] {
  const parties: DocumentParty[] = [];
  let current: DocumentParty | null = null;
  let expectName = false;
  const conflicting = new Set<DocumentParty>();
  for (const line of lines) {
    const folded = fold(line);
    const heading = /^(dodavatel|odberatel|supplier|customer|seller|buyer)\s*[:|]/.exec(folded);
    if (heading) {
      current = { name: null, ico: null, dic: null, icDph: null };
      parties.push(current);
      expectName = true;
      const tail = line.slice(heading[0].length).replace(/^[ :|]+/, "").trim();
      if (tail && !/^(ico|dic|ic dph|vat|tax)/.test(fold(tail))) {
        current.name = tail.split("|")[0]!.trim();
        expectName = false;
      }
    }
    if (!current) continue;
    if (expectName && !heading && /^[\p{L}]/u.test(line) && !/^(ico|dic|ic dph|postova adresa|fakturacna adresa|datum|iban|banka)/.test(folded)) {
      current.name = line.split("|")[0]!.trim();
      expectName = false;
    }
    const identifiers: Array<["ico" | "dic" | "icDph", RegExp]> = [
      ["ico", /\bico\s*[:|]\s*((?:\d[ \u00a0]*){8})(?!\d)/],
      ["dic", /\bdic\s*[:|]\s*(\d{8,10})(?!\d)/],
      ["icDph", /(?:ic\s*dph|vat(?:\s*id)?)\s*[:|]\s*([a-z]{2}\s*\d{6,12})(?!\d)/],
    ];
    for (const [key, pattern] of identifiers) {
      const match = pattern.exec(folded);
      if (!match) continue;
      const value = match[1]!.replace(/\s/g, "").toUpperCase();
      if (current[key] && current[key] !== value) conflicting.add(current);
      else current[key] = value;
    }
  }
  // Ambiguous blocks must not silently attach another party's identifiers.
  return parties.filter(party => !conflicting.has(party) && (party.name || party.ico || party.icDph));
}

function recapFromLines(lines: readonly string[]): DocumentVatRecapRow[] {
  const rows = new Map<string, DocumentVatRecapRow>();
  let inTable = false;
  const conflicts = new Set<string>();
  const setRow = (row: DocumentVatRecapRow) => {
    const previous = rows.get(row.rateLiteral);
    if (previous && (previous.baseCents !== row.baseCents || previous.vatCents !== row.vatCents)) conflicts.add(row.rateLiteral);
    else rows.set(row.rateLiteral, row);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = fold(line);
    if (/sadzba|sazba|rate/.test(f) && /zaklad|base/.test(f) && /dph|vat/.test(f)) {
      inTable = true;
      continue;
    }
    if (inTable) {
      const rate = /^\s*(\d{1,2}(?:[.,]\d+)?)\s*%\s*\|/.exec(line);
      const cells = amounts(line.slice(line.indexOf("|") + 1));
      if (rate && cells.length >= 2) {
        setRow({rateLiteral: rate[1]!.replace(",", "."), baseLiteral: cells[0]!.literal, baseCents: cells[0]!.cents, vatLiteral: cells[1]!.literal, vatCents: cells[1]!.cents});
        continue;
      }
      inTable = false;
    }
    const baseRate = /zaklad (?:pre )?dph\s*(\d{1,2})\s*%/.exec(f);
    if (baseRate && i + 1 < lines.length) {
      const next = lines[i + 1]!;
      const vatRate = /^dph\s*(\d{1,2})\s*(?:\|\s*)?%/.exec(fold(next));
      const base = amounts(line), vat = amounts(next);
      if (vatRate?.[1] === baseRate[1] && base.length === 1 && vat.length === 1) {
        setRow({rateLiteral: baseRate[1]!, baseLiteral: base[0]!.literal, baseCents: base[0]!.cents, vatLiteral: vat[0]!.literal, vatCents: vat[0]!.cents});
      }
    }
  }
  return [...rows.values()].filter(row => !conflicts.has(row.rateLiteral));
}

/** Experimental parser: only printed, unambiguous evidence; no model calls. */
export function parseDeterministicInvoice(lines: readonly string[]): ModelExtractedPayload {
  const dates = labelledDates(lines);
  const date = (kind: DateLabel) => unique([...dates].filter(([, kinds]) => kinds.has(kind)).map(([value]) => value));
  const totals = lines.flatMap(line => {
    // Invoice value, not the remaining balance after deposits or payments.
    if (!/celkova (?:fakturovana suma|suma s dph|hodnota plnenia)|(?:grand|invoice) total|total (?:incl|including)/.test(fold(line))) return [];
    const values = amounts(line);
    return values.length === 1 ? values : [];
  });
  const total = totals.length && new Set(totals.map(x => x.cents)).size === 1 ? totals[0]! : null;
  const currencies = lines.flatMap(line => [...line.matchAll(/\b(EUR|CZK|USD|GBP)\b/g)].map(x => x[1]!));
  return {
    kind: "extracted", parties: partiesFromBlocks(lines),
    documentNumber: labelledValue(lines, /(?:faktura (?:cislo|c\.)|cislo faktury|invoice (?:number|no\.?))\s*/ ),
    variableSymbol: labelledValue(lines, /variabiln[yi] symbol\s*/ ),
    issueDate: date("issue"), taxableSupplyDate: date("taxable"), dueDate: date("due"),
    currency: unique(currencies) ?? (lines.some(x => x.includes("€")) ? "EUR" : ""),
    amountCents: total?.cents ?? null, amountLiteral: total?.literal ?? null,
    vatRecap: recapFromLines(lines), docTypeHint: null,
  };
}
