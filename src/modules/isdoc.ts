import { XMLParser } from "fast-xml-parser";
import type { DocTypeHint, DocumentParty, DocumentVatRecapRow, ModelExtractedPayload } from "./document-payload";
import { formatEuroFromCents } from "./money";
import {
  normalizeModelDate,
  normalizeModelIco,
  normalizeModelIcDph,
  normalizeModelDic,
  normalizeModelVariableSymbol,
} from "./model-output-normalize";

/**
 * ISDOC is the Czech and Slovak structured invoice. Invoicing software such as
 * KROS Omega embeds it in the PDF it prints (`invoice.isdoc`, PDF/A-3
 * "Alternative"): the same invoice as data, so it is read exactly instead of by
 * OCR and a model. Her issued invoices all carry one.
 */

const ISDOC_NAMESPACE = "http://isdoc.cz/namespace/2013";

export function isIsdocXml(text: string): boolean {
  return text.includes(ISDOC_NAMESPACE) && /<Invoice[\s>]/.test(text);
}

// ISDOC DocumentType: 1 invoice, 2 credit note, 3 debit note, 4 advance
// invoice (not a tax document), 5 tax document for a received advance, 6
// credit note for one, 7 simplified tax document.
const DOCUMENT_TYPES: Record<string, DocTypeHint> = {
  "1": "invoice",
  "2": "credit_note",
  "3": "invoice",
  "4": "proforma",
  "5": "advance_tax_document",
  "6": "credit_note",
  "7": "invoice",
};

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Values stay strings: `2026081` is a document number, not a number.
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["TaxSubTotal", "PartyTaxScheme", "Payment", "InvoiceLine"].includes(name),
});

function node(value: unknown): Node | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Node) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function at(root: unknown, ...path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    const next = node(current);
    if (!next) {
      return undefined;
    }
    current = next[key];
  }
  return current;
}

/**
 * ISDOC amounts carry up to four decimals (`563.9600`); cents are taken from
 * the digits, never through a float, rounded half away from zero.
 */
export function isdocAmountToCents(literal: string | null): number | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec((literal ?? "").trim());
  if (!match) {
    return null;
  }
  const [, sign, whole, fraction = ""] = match;
  const padded = fraction.padEnd(3, "0");
  let cents = Number(whole) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) {
    cents += 1;
  }
  return sign === "-" ? -cents : cents;
}

function party(value: unknown): DocumentParty | null {
  const partyNode = at(value, "Party");
  if (!node(partyNode)) {
    return null;
  }
  const schemes = (at(partyNode, "PartyTaxScheme") as unknown[] | undefined) ?? [];
  const scheme = (kind: string) =>
    text(at(schemes.find((entry) => text(at(entry, "TaxScheme")) === kind), "CompanyID"));
  return {
    name: text(at(partyNode, "PartyName", "Name")),
    ico: normalizeModelIco(text(at(partyNode, "PartyIdentification", "ID"))),
    // For a Slovak party VAT is the IČ DPH and TIN the DIČ; a Czech party's
    // VAT id (CZ…) is its DIČ, filed as the IČ DPH as the checks expect.
    icDph: normalizeModelIcDph(scheme("VAT")),
    dic: normalizeModelDic(scheme("TIN")),
  };
}

export function parseIsdocInvoice(xml: string): ModelExtractedPayload | null {
  if (!isIsdocXml(xml)) {
    return null;
  }
  let invoice: Node | null;
  try {
    invoice = node(node(parser.parse(xml))?.Invoice);
  } catch {
    return null;
  }
  if (!invoice) {
    return null;
  }

  const foreignCurrency = text(invoice.ForeignCurrencyCode);
  const currency = foreignCurrency ?? text(invoice.LocalCurrencyCode) ?? "EUR";
  // Amounts in a foreign currency are the *Curr elements; the plain ones are
  // the local-currency equivalents.
  const amount = (source: unknown, name: string) =>
    text(at(source, foreignCurrency ? `${name}Curr` : name));

  const docTypeHint = DOCUMENT_TYPES[text(invoice.DocumentType) ?? ""] ?? "invoice";
  // ISDOC states a credit note's amounts as positive, the kind carrying the
  // sign; the app books them negative, as her credit notes print them.
  const sign = docTypeHint === "credit_note" ? -1 : 1;
  const signed = (cents: number | null) => (cents === null ? null : Math.abs(cents) * sign);

  const vatRecap: DocumentVatRecapRow[] = [];
  for (const subtotal of (at(invoice, "TaxTotal", "TaxSubTotal") as unknown[] | undefined) ?? []) {
    const baseCents = signed(isdocAmountToCents(amount(subtotal, "TaxableAmount")));
    const vatCents = signed(isdocAmountToCents(amount(subtotal, "TaxAmount")));
    const rate = text(at(subtotal, "TaxCategory", "Percent"));
    if (baseCents === null || vatCents === null || rate === null) {
      continue;
    }
    vatRecap.push({
      rateLiteral: rate,
      baseLiteral: formatEuroFromCents(baseCents),
      baseCents,
      vatLiteral: formatEuroFromCents(vatCents),
      vatCents,
    });
  }

  const amountCents = signed(isdocAmountToCents(amount(invoice.LegalMonetaryTotal, "TaxInclusiveAmount")));
  const payment = ((at(invoice, "PaymentMeans", "Payment") as unknown[] | undefined) ?? [])[0];

  return {
    kind: "extracted",
    source: "isdoc",
    parties: [party(invoice.AccountingSupplierParty), party(invoice.AccountingCustomerParty)].filter(
      (entry): entry is DocumentParty => entry !== null,
    ),
    documentNumber: text(invoice.ID),
    variableSymbol: normalizeModelVariableSymbol(text(at(payment, "Details", "VariableSymbol"))),
    issueDate: normalizeModelDate(text(invoice.IssueDate)),
    taxableSupplyDate: normalizeModelDate(text(invoice.TaxPointDate)),
    dueDate: normalizeModelDate(text(at(payment, "Details", "PaymentDueDate"))),
    currency,
    amountCents,
    amountLiteral: amountCents === null ? null : formatEuroFromCents(amountCents),
    vatRecap,
    docTypeHint,
  };
}
