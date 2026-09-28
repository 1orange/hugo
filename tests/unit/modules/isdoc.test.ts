import { test } from "node:test";
import assert from "node:assert/strict";
import { isdocAmountToCents, parseIsdocInvoice } from "../../../src/modules/isdoc.ts";

function isdoc(overrides: { documentType?: string; currency?: string; body?: string } = {}): string {
  const foreign = overrides.currency ? `<ForeignCurrencyCode>${overrides.currency}</ForeignCurrencyCode>` : "";
  return `<?xml version="1.0"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>${overrides.documentType ?? "1"}</DocumentType>
  <ID>2026999</ID>
  <IssueDate>2026-05-26</IssueDate>
  <TaxPointDate>2026-05-25</TaxPointDate>
  <LocalCurrencyCode>EUR</LocalCurrencyCode>${foreign}
  <AccountingSupplierParty><Party>
    <PartyIdentification><UserID/><ID>12345678</ID></PartyIdentification>
    <PartyName><Name>Dodávateľ &amp; syn s.r.o.</Name></PartyName>
    <PartyTaxScheme><CompanyID>SK1234567890</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
    <PartyTaxScheme><CompanyID>1234567890</CompanyID><TaxScheme>TIN</TaxScheme></PartyTaxScheme>
  </Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party>
    <PartyIdentification><ID>87654321</ID></PartyIdentification>
    <PartyName><Name>Odberateľ a.s.</Name></PartyName>
    <PartyTaxScheme><CompanyID>SK 0987654321</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
  </Party></AccountingCustomerParty>
  ${overrides.body ?? `<TaxTotal>
    <TaxSubTotal><TaxableAmount>100.0000</TaxableAmount><TaxAmount>5.00</TaxAmount><TaxCategory><Percent>5</Percent></TaxCategory></TaxSubTotal>
    <TaxSubTotal><TaxableAmount>200.004</TaxableAmount><TaxAmount>46.005</TaxAmount><TaxCategory><Percent>23</Percent></TaxCategory></TaxSubTotal>
  </TaxTotal>
  <LegalMonetaryTotal><TaxInclusiveAmount>351.01</TaxInclusiveAmount><PayableAmount>0.00</PayableAmount></LegalMonetaryTotal>`}
  <PaymentMeans><Payment><Details>
    <PaymentDueDate>2026-06-10</PaymentDueDate>
    <VariableSymbol>2026999</VariableSymbol>
  </Details></Payment></PaymentMeans>
</Invoice>`;
}

test("an ISDOC invoice becomes the same payload a model would give, exactly", () => {
  const payload = parseIsdocInvoice(isdoc());
  assert.ok(payload);
  assert.equal(payload.source, "isdoc");
  assert.equal(payload.documentNumber, "2026999");
  assert.equal(payload.variableSymbol, "2026999");
  assert.equal(payload.issueDate, "2026-05-26");
  assert.equal(payload.taxableSupplyDate, "2026-05-25");
  assert.equal(payload.dueDate, "2026-06-10");
  assert.equal(payload.currency, "EUR");
  assert.equal(payload.docTypeHint, "invoice");
  assert.deepEqual(payload.parties, [
    { name: "Dodávateľ & syn s.r.o.", ico: "12345678", icDph: "SK1234567890", dic: "1234567890" },
    { name: "Odberateľ a.s.", ico: "87654321", icDph: "SK0987654321", dic: null },
  ]);
  assert.deepEqual(
    payload.vatRecap.map((row) => [row.rateLiteral, row.baseCents, row.vatCents]),
    [
      ["5", 10000, 500],
      ["23", 20000, 4601],
    ],
  );
  // The document's total, not what is left to pay after an advance.
  assert.equal(payload.amountCents, 35101);
  assert.equal(payload.amountLiteral, "351.01");
});

test("ISDOC amounts are read to the cent from their digits", () => {
  assert.equal(isdocAmountToCents("563.9600"), 56396);
  assert.equal(isdocAmountToCents("458.5"), 45850);
  assert.equal(isdocAmountToCents("1"), 100);
  assert.equal(isdocAmountToCents("0.005"), 1);
  assert.equal(isdocAmountToCents("-12.345"), -1235);
  assert.equal(isdocAmountToCents("12,50"), null);
  assert.equal(isdocAmountToCents(null), null);
});

// ISDOC states a credit note's amounts as positive; the app books them
// negative, as a printed credit note shows them.
test("a credit note's amounts are negative", () => {
  const payload = parseIsdocInvoice(isdoc({ documentType: "2" }));
  assert.equal(payload?.docTypeHint, "credit_note");
  assert.equal(payload?.amountCents, -35101);
  assert.deepEqual(payload?.vatRecap.map((row) => row.baseCents), [-10000, -20000]);
});

test("an invoice in a foreign currency is read in that currency", () => {
  const payload = parseIsdocInvoice(
    isdoc({
      currency: "CZK",
      body: `<TaxTotal><TaxSubTotal>
        <TaxableAmount>40.00</TaxableAmount><TaxableAmountCurr>1000.00</TaxableAmountCurr>
        <TaxAmount>8.40</TaxAmount><TaxAmountCurr>210.00</TaxAmountCurr>
        <TaxCategory><Percent>21</Percent></TaxCategory>
      </TaxSubTotal></TaxTotal>
      <LegalMonetaryTotal><TaxInclusiveAmount>48.40</TaxInclusiveAmount><TaxInclusiveAmountCurr>1210.00</TaxInclusiveAmountCurr></LegalMonetaryTotal>`,
    }),
  );
  assert.equal(payload?.currency, "CZK");
  assert.equal(payload?.amountCents, 121000);
  assert.deepEqual(payload?.vatRecap.map((row) => [row.baseCents, row.vatCents]), [[100000, 21000]]);
});

test("XML that is not ISDOC is not read as an invoice", () => {
  assert.equal(parseIsdocInvoice("<?xml version=\"1.0\"?><Invoice><ID>1</ID></Invoice>"), null);
  assert.equal(parseIsdocInvoice("not xml at all"), null);
});
