import { test } from "node:test";
import assert from "node:assert/strict";
import { molSellerIco, parseMolInvoice, printedIcos } from "../../../src/modules/mol-invoice.ts";

// The shape Slovnaft's fuel-card invoices attach; the values are made up.
function molXml(overrides: { currency?: string; sellerTax?: string; sellerVat?: string; type?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<invoice xmlns:invoice="http://www.mol.hu/e-invoice" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<header>
<seller><name>Palivá Slovensko, a.s.</name><businessunit>CARD</businessunit>
<taxnumber>${overrides.sellerTax ?? "2020111111"}</taxnumber><eutaxnumber>${overrides.sellerVat ?? "SK7020111111"}</eutaxnumber></seller>
<buyer><name>Modrá hora s. r. o.</name><customerid>1234567</customerid>
<taxnumber>2020123456</taxnumber><eutaxnumber>SK2020123456</eutaxnumber></buyer>
<invoiceinfo><invoicenumber> 4500000001</invoicenumber><invoicedate>2026.05.18</invoicedate>
<deliverydate>2026.05.15</deliverydate><duedate>2026.06.01</duedate>
<invoicetype>${overrides.type ?? "NORMAL"}</invoicetype><correctedinvoicenumber> </correctedinvoicenumber>
<currency>${overrides.currency ?? "EUR"}</currency></invoiceinfo>
</header>
<items><item id="1"><productname>Diesel</productname><netamount>81,32</netamount></item></items>
<summary>
<vatcell id="1"><vatpercent>23%</vatpercent><netamount>270,74</netamount><vatamount>62,27</vatamount><grossamount>333,01</grossamount></vatcell>
<netamountsummary>270,74</netamountsummary><vatamountsummary>62,27</vatamountsummary>
<grossamountsummary>333,01</grossamountsummary>
</summary>
</invoice>`;
}

test("a MOL e-invoice is read as data", () => {
  const payload = parseMolInvoice(molXml());
  assert.ok(payload);
  assert.equal(payload.source, "mol");
  assert.equal(payload.documentNumber, "4500000001");
  assert.deepEqual([payload.issueDate, payload.taxableSupplyDate, payload.dueDate], ["2026-05-18", "2026-05-15", "2026-06-01"]);
  assert.equal(payload.currency, "EUR");
  assert.equal(payload.amountCents, 33301);
  assert.deepEqual(payload.vatRecap.map((row) => [row.rateLiteral, row.baseCents, row.vatCents]), [["23%", 27074, 6227]]);
  assert.deepEqual(payload.parties, [
    { name: "Palivá Slovensko, a.s.", ico: null, dic: "2020111111", icDph: "SK7020111111" },
    { name: "Modrá hora s. r. o.", ico: null, dic: "2020123456", icDph: "SK2020123456" },
  ]);
  assert.equal(payload.docTypeHint, "invoice");
});

test("a Czech MOL invoice keeps its currency and its CZ DIČ, and writes thousands with a space", () => {
  const xml = molXml({ currency: "CZK", sellerTax: "CZ49000001", sellerVat: "CZ49000001" })
    .replace("<grossamountsummary>333,01</grossamountsummary>", "<grossamountsummary>1 139,24</grossamountsummary>")
    .replace("<netamount>270,74</netamount><vatamount>", "<netamount>2 032,19</netamount><vatamount>");
  const payload = parseMolInvoice(xml);
  assert.equal(payload?.currency, "CZK");
  assert.equal(payload?.amountCents, 113924);
  assert.equal(payload?.vatRecap[0]?.baseCents, 203219);
  assert.deepEqual(payload?.parties[0], { name: "Palivá Slovensko, a.s.", ico: null, dic: "CZ49000001", icDph: "CZ49000001" });
});

test("what is not a plain MOL invoice is left to the model", () => {
  assert.equal(parseMolInvoice(molXml({ type: "CORRECTION" })), null);
  assert.equal(parseMolInvoice("<invoice><header/></invoice>"), null);
  assert.equal(parseMolInvoice("not xml at all"), null);
});

test("IČOs are read beside their label, never an IČ DPH", () => {
  assert.deepEqual(
    printedIcos([
      "IČO/Registration no: 31000001 | IČO/Registration no: 36123456",
      "IČ pre DPH/VAT registration no: SK7020111111",
      "IČ DPH: SK2020123456 | DIČ /IČ pre DPH: CZ49000001",
      "IČO: 50 861 930",
      "IČ/IČO: 49000001",
    ]),
    ["31000001", "36123456", "50861930", "49000001"],
  );
});

test("the seller's IČO: a Czech one from its DIČ, else the one that is not hers", () => {
  const slovak = { name: "Palivá Slovensko, a.s.", ico: null, dic: "2020111111", icDph: "SK7020111111" };
  const lines = ["IČO/Registration no: 31000001 | IČO/Registration no: 36123456"];
  assert.equal(molSellerIco(slovak, lines, "36123456"), "31000001");
  // Hers unknown, two printed: nobody's.
  assert.equal(molSellerIco(slovak, lines, null), null);
  // A Czech invoice also prints where it was printed.
  const czech = { name: "Palivá CZ, s.r.o.", ico: null, dic: "CZ49000001", icDph: "CZ49000001" };
  assert.equal(molSellerIco(czech, ["IČ/IČO: 49000001", "IČ/IČO: 31000001"], "36123456"), "49000001");
});
