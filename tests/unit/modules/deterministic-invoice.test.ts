import test from "node:test";
import assert from "node:assert/strict";
import { parseDeterministicInvoice } from "../../../src/modules/deterministic-invoice.ts";

test("distinguishes labelled dates and does not invent a missing date", () => {
  const p = parseDeterministicInvoice(["Dátum vyhotovenia: | 03.05.2026", "Dátum splatnosti: | 17.05.2026"]);
  assert.equal(p.issueDate, "2026-05-03");
  assert.equal(p.dueDate, "2026-05-17");
  assert.equal(p.taxableSupplyDate, null);
});
test("conflicting printed values are left empty", () => {
  const p = parseDeterministicInvoice(["Variabilný symbol: 123", "Variabilný symbol: 456", "Celková suma s DPH | 10,00 EUR", "Celková suma s DPH | 11,00 EUR"]);
  assert.equal(p.variableSymbol, null);
  assert.equal(p.amountCents, null);
});
test("invoice value is distinct from remaining balance", () => {
  const p = parseDeterministicInvoice(["Celková hodnota plnenia: 1 234,56 EUR", "Celkom k úhrade vrátane DPH | 0,00 EUR"]);
  assert.equal(p.amountCents, 123456);
  assert.equal(p.amountLiteral, "1 234,56");
});
test("VAT table rows require a recap header, not a line item", () => {
  assert.deepEqual(parseDeterministicInvoice(["23% | 100,00 | 23,00 | 123,00"]).vatRecap, []);
  const p = parseDeterministicInvoice(["Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH", "23% | 100,00 | 23,00 | 123,00"]);
  assert.equal(p.vatRecap[0]?.baseCents, 10000);
  assert.equal(p.vatRecap[0]?.vatCents, 2300);
});
test("keeps identifiers with their labelled party", () => {
  const p = parseDeterministicInvoice(["Dodávateľ:", "Seller s.r.o.", "IČO: 31592503", "Odberateľ:", "Buyer s.r.o.", "IČO: 45891761"]);
  assert.deepEqual(p.parties.map(x => x.ico), ["31592503", "45891761"]);
});
test("mixed currencies and conflicting dates remain ambiguous", () => {
  const p = parseDeterministicInvoice(["USD EUR", "Dátum vystavenia: 01.05.2026", "Dátum vystavenia: 02.05.2026"]);
  assert.equal(p.currency, "");
  assert.equal(p.issueDate, null);
});

test("a decimal VAT percentage is not parsed as the base amount", () => {
  const p = parseDeterministicInvoice(["Sadzba | Základ DPH | Čiastka DPH", "23.00 % | 100,00 | 23,00"]);
  assert.equal(p.vatRecap[0]?.baseCents, 10000);
  assert.equal(p.vatRecap[0]?.vatCents, 2300);
});
