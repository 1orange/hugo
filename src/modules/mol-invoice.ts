import { XMLParser } from "fast-xml-parser";
import type { DocumentParty, DocumentVatRecapRow, ModelExtractedPayload } from "./document-payload";
import { parseSignedDecimalAmount } from "./money";
import { normalizeModelDic, normalizeModelIcDph } from "./model-output-normalize";

/**
 * The MOL group's e-invoice. Slovnaft and MOL Česká republika attach their
 * fuel-card invoices as XML (`…_I_CARD.xml`): number, dates, both parties' tax
 * numbers and the VAT summary, as data. It is read exactly, like an ISDOC —
 * the model had given Slovnaft its VAT number for a DIČ on every one.
 *
 * It carries no IČO: the seller's is taken from the invoice's text
 * (molSellerIco).
 */
const MOL_NAMESPACE = "http://www.mol.hu/e-invoice";

export function isMolInvoiceXml(text: string): boolean {
  return text.includes(MOL_NAMESPACE) && /<invoice[\s>]/.test(text);
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Values stay strings: `4592518967` is an invoice number, not a number.
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["vatcell", "item"].includes(name),
});

function node(value: unknown): Node | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Node) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// MOL writes dates as 2026.05.18.
function molDate(value: unknown): string | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(text(value) ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

// And amounts as 270,74 — a Czech one as 1 139,24.
function molAmount(value: unknown): { literal: string; cents: number } | null {
  const literal = text(value)?.replace(/[\s\u00a0\u202f]/g, "");
  if (!literal) {
    return null;
  }
  const parsed = parseSignedDecimalAmount(literal);
  return "ok" in parsed ? null : parsed;
}

function party(value: unknown): DocumentParty | null {
  const entry = node(value);
  const name = text(entry?.name);
  if (!entry || !name) {
    return null;
  }
  return {
    name,
    ico: null,
    dic: normalizeModelDic(text(entry.taxnumber)),
    icDph: normalizeModelIcDph(text(entry.eutaxnumber)),
  };
}

/** A MOL e-invoice as the app's extracted payload; null when it is not one, or not a plain invoice. */
export function parseMolInvoice(xml: string): ModelExtractedPayload | null {
  if (!isMolInvoiceXml(xml)) {
    return null;
  }
  let document: Node | null;
  try {
    document = node(parser.parse(xml));
  } catch {
    return null;
  }
  const invoice = node(document?.invoice);
  const header = node(invoice?.header);
  const info = node(header?.invoiceinfo);
  const summary = node(invoice?.summary);
  if (!header || !info || !summary) {
    return null;
  }
  // Only what her invoices have shown: a correction's number and signs are
  // not known until one arrives, so it goes to the model meanwhile.
  if (text(info.invoicetype) !== "NORMAL") {
    return null;
  }

  const vatRecap: DocumentVatRecapRow[] = [];
  for (const cell of (summary.vatcell as unknown[] | undefined) ?? []) {
    const entry = node(cell);
    const base = molAmount(entry?.netamount);
    const vat = molAmount(entry?.vatamount);
    const rate = text(entry?.vatpercent);
    if (!base || !vat || !rate) {
      continue;
    }
    vatRecap.push({ rateLiteral: rate, baseLiteral: base.literal, baseCents: base.cents, vatLiteral: vat.literal, vatCents: vat.cents });
  }
  const total = molAmount(summary.grossamountsummary);

  return {
    kind: "extracted",
    source: "mol",
    parties: [party(header.seller), party(header.buyer)].filter((entry): entry is DocumentParty => entry !== null),
    documentNumber: text(info.invoicenumber),
    variableSymbol: null,
    issueDate: molDate(info.invoicedate),
    taxableSupplyDate: molDate(info.deliverydate),
    dueDate: molDate(info.duedate),
    currency: text(info.currency) ?? "EUR",
    amountCents: total?.cents ?? null,
    amountLiteral: total?.literal ?? null,
    vatRecap,
    docTypeHint: "invoice",
  };
}

// An IČO as printed beside its label: "IČO: 50 861 930", "IČO/Registration no:
// 31322832", the Czech "IČ: 49450301" — not "IČ DPH" or "IČ pre DPH".
const PRINTED_ICO = /(?<![\p{L}])I[ČC]O?(?![\p{L}])(?![\s:]*(?:pre\s+)?DPH)[^\d\n]{0,30}?(\d{2} ?\d{3} ?\d{3})(?!\d)/gu;

/** The IČOs a text prints under their label, in order, without spaces. */
export function printedIcos(lines: readonly string[]): string[] {
  return lines.flatMap((line) => [...line.matchAll(PRINTED_ICO)].map((match) => match[1]!.replace(/ /g, "")));
}

/**
 * The seller's IČO, from the invoice's text. A Czech company's DIČ is CZ and
 * its IČO, when the text prints that IČO; otherwise the one IČO printed that
 * is not the buyer's. A Czech MOL invoice also prints Slovnaft's, as where it
 * was printed, so there the DIČ decides.
 */
export function molSellerIco(
  seller: DocumentParty,
  lines: readonly string[],
  buyerIco: string | null,
): string | null {
  const printed = new Set(printedIcos(lines));
  const czech = /^CZ(\d{8})$/.exec(seller.dic ?? seller.icDph ?? "");
  if (czech && printed.has(czech[1]!)) {
    return czech[1]!;
  }
  const others = [...printed].filter((ico) => ico !== buyerIco?.replace(/\s/g, ""));
  return others.length === 1 ? others[0]! : null;
}
