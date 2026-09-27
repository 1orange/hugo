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
