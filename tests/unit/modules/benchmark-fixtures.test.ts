import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkLabels } from "../../../src/modules/benchmark-fixtures.ts";

// The register's two dates are when the tax arose and when she deducted it;
// it has no issue date and no variabilný symbol, so neither is invented.
test("a received label holds only what her VAT register records", () => {
  const [label] = buildBenchmarkLabels({
    t01ExportText: "",
    vatRegisterLines: [
      "DF | 3999001 | SUP-001 | 07.05.2026 | 09.05.2026 | SK1234567890 | Supplier | Services | B2 | 26,83 | 6,17",
    ],
    manifest: {
      monthKey: "2026_05",
      issued: [],
      received: [{ driveFileId: "drive-1", matchKey: "SUP-001", folderSlot: "02 Prijaté faktúry" }],
    },
  });
  assert.equal(label?.documentNumber, "SUP-001");
  assert.equal(label?.taxableSupplyDate, "2026-05-07");
  assert.equal(label?.variableSymbol, null);
  assert.equal(label?.issueDate, null);
  assert.equal(label?.amountCents, 3300);
});

test("a receipt's label has no document number: the register holds only hers", () => {
  const [label] = buildBenchmarkLabels({
    t01ExportText: "",
    vatRegisterLines: [
      "IDk | IDk26007 | 01.05.2026 | 01.05.2026 | SK2121428375 | Zamkni | Batteries | B3 | 8,13 | 1,87",
    ],
    manifest: {
      monthKey: "2026_05",
      issued: [],
      received: [{ driveFileId: "drive-2", matchKey: "IDk26007", folderSlot: "05 Bločky_firemná karta" }],
    },
  });
  assert.equal(label?.documentNumber, null);
  assert.equal(label?.docTypeHint, "receipt");
  assert.equal(label?.amountCents, 1000);
});
