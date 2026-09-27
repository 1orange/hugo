import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVatRegisterDeductionLines,
  parseVatRegisterDeductionRow,
} from "../../../src/modules/vat-register-import.ts";

test("parseVatRegisterDeductionRow reads a domestic received invoice row", () => {
  const row = parseVatRegisterDeductionRow(
    "DF | 3999001 | SUP-001 | 07.05.2026 | 07.05.2026 | SK1234567890 | Supplier | Services | B2 | 26,83 | 6,17",
  );
  assert.ok(row);
  assert.equal(row.internalNumber, "3999001");
  assert.equal(row.supplierDocumentNumber, "SUP-001");
  assert.equal(row.kvDphSection, "B2");
  assert.equal(row.vatRecap[0]?.baseCents, 2683);
  assert.equal(row.vatRecap[0]?.vatCents, 617);
});

test("parseVatRegisterDeductionLines joins a split FDD head line", () => {
  const rows = parseVatRegisterDeductionLines([
    "FDD 3999002",
    "SUP-002 | 15.05.2026 | 15.05.2026 | SK1234567891 | Hotel | Advance | B2 | 89,43 | 20,57",
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.evidenceCode, "FDD");
  assert.equal(rows[0]?.internalNumber, "3999002");
});

// The register prints a reduced-rate and a standard-rate column, but text
// extraction drops empty cells, so only the section heading says which rate a
// single base/VAT pair belongs to. Grand hotel in spring 2026_05 is split
// across the 5% section (18a) and the 23% section (19).
test("parseVatRegisterDeductionLines takes each row's rate from its section heading", () => {
  const rows = parseVatRegisterDeductionLines([
    "18a - Tovary a služby kúpené v tuzemsku pod | ľ | a § 49 ods. 2 písm. a) - znížená sadzba DPH 2",
    "FDD 3999003",
    "SUP-003 | 15. 05.2026 | 15. 05. 2026 | SK 1234567892 | Hotel | Advance | B2 | 1 125,14 | 56,26",
    "18 - Tovary a služby kúpené v tuzemsku pod | ľ | a § 49 ods. 2 písm. a) - znížená sadzba DPH",
    "DF | 3999004 | SUP-004 | 11. 05.2026 | 11. 05. 2026 | SK 1234567893 | Books | Books | B2 | 100,00 | 19,00",
    "19 - Tovary a služby kúpené v tuzemsku pod | ľ | a § 49 ods. 2 písm. a) - základná sadzba DPH",
    "DF | 3999005 | SUP-005 | 07. 05.2026 | 07. 05. 2026 | SK 1234567894 | Telco | Phone | B2 | 26,83 | 6,17",
    "FDD 3999003 | SUP-003 | 15. 05.2026 | 15. 05. 2026 | SK 1234567892 | Hotel | Advance | B2 | 89,43 | 20,57",
  ]);
  const rateOf = (internalNumber: string) =>
    rows
      .filter((row) => row.internalNumber === internalNumber)
      .flatMap((row) => row.vatRecap.map((entry) => entry.rateLiteral));
  assert.deepEqual(rateOf("3999003"), ["5", "23"]);
  assert.deepEqual(rateOf("3999004"), ["19"]);
  assert.deepEqual(rateOf("3999005"), ["23"]);
});

test("a row before any section heading keeps the standard rate", () => {
  const rows = parseVatRegisterDeductionLines([
    "DF | 3999006 | SUP-006 | 07.05.2026 | 07.05.2026 | SK1234567895 | Supplier | Services | B2 | 26,83 | 6,17",
  ]);
  assert.equal(rows[0]?.vatRecap[0]?.rateLiteral, "23");
});
