import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseOmegaT01IssuedInvoices,
  skCalendarRawToIso,
} from "../../../src/modules/omega-t01-import.ts";

test("parseOmegaT01IssuedInvoices reads header fields from an R01 row", () => {
  const cols = new Array(97).fill("");
  cols[0] = "R01";
  cols[1] = "2026999";
  cols[2] = "Client s.r.o.";
  cols[3] = "12345678";
  cols[4] = "19.05.2026";
  cols[5] = "03.06.2026";
  cols[6] = "19.05.2026";
  cols[8] = "100.00";
  cols[12] = "23";
  cols[14] = "23.00";
  cols[16] = "123.00";
  cols[39] = "EUR";
  cols[70] = "2026999";

  const [invoice] = parseOmegaT01IssuedInvoices([cols.join("\t")].join("\n"));
  assert.ok(invoice);
  assert.equal(invoice.documentNumber, "2026999");
  assert.equal(invoice.customerIco, "12345678");
  assert.equal(invoice.amountCents, 12300);
  assert.equal(invoice.vatRecap[0]?.baseCents, 10000);
  assert.equal(invoice.vatRecap[0]?.vatCents, 2300);
});

test("skCalendarRawToIso accepts spaced Slovak dates", () => {
  assert.equal(skCalendarRawToIso("07. 05. 2026"), "2026-05-07");
});
