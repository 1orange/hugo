import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { settleAdvance } from "../../../src/modules/advance-settlement.ts";
import type { BenchmarkLabel } from "../../../src/modules/benchmark-label.ts";
import type { DocumentVatRecapRow } from "../../../src/modules/document-payload.ts";

// The three settled invoices of the benchmark corpus. Their text is read from
// the private text layer; the model's answer is stood in for by the rows it
// reads off the recap (the advance lines are left to the text).
const BENCHMARK = path.join(process.cwd(), "tests/private-fixtures/benchmark");
const TEXTS = path.join(BENCHMARK, "legacy-rows-text");

const SETTLED = [
  {
    driveFileId: "1DVnRi-DJZMvvgM50K_dcDo4V7zhaYMqt",
    // Zero-rated supply, the advance cancelled by negative 0% rows.
    modelTotalCents: 0,
    modelRows: [{ rate: "0", baseCents: 4389, vatCents: 0 }],
    supply: { base: 4389, vat: 0, total: 4389 },
    advance: 4389,
    documentNumbers: ["ZDD15873826"],
    labelBase: 4389,
  },
  {
    driveFileId: "1yKh4LzDtPVa2iVgfiI1b4s72pUC-VVFi",
    // 23 % supply, the advance cancelled by negative 23 % rows.
    modelTotalCents: 0,
    modelRows: [{ rate: "23", baseCents: 3251, vatCents: 748 }],
    supply: { base: 3251, vat: 748, total: 3999 },
    advance: 3999,
    documentNumbers: ["ZDD15262026"],
    // Omega's booked base is the 39,99 gross (with 9,20 VAT she self-assessed
    // on it), not the printed 32,51: the label is left as booked, not compared.
    labelBase: null,
  },
  {
    driveFileId: "13sr6PjMABglbRrt351I957sFGWYPhe2f",
    // The full recap: 364,65 + 83,87 = 448,52, with the advance and k úhrade 0,00.
    modelTotalCents: 44852,
    modelRows: [{ rate: "23", baseCents: 36465, vatCents: 8387 }],
    supply: { base: 36465, vat: 8387, total: 44852 },
    advance: 44852,
    documentNumbers: ["5926010455"],
    labelBase: 36465,
  },
];

function readLines(driveFileId: string): string[] | null {
  const file = path.join(TEXTS, `${driveFileId}.txt`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : null;
}

function readLabel(driveFileId: string): BenchmarkLabel | null {
  const file = path.join(BENCHMARK, `${driveFileId}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as BenchmarkLabel) : null;
}

const available = SETTLED.every((doc) => readLines(doc.driveFileId) !== null && readLabel(doc.driveFileId) !== null);

for (const doc of SETTLED) {
  test(
    `private corpus ${doc.driveFileId}: the supply total, base and VAT, not the amount due`,
    { skip: available ? false : "tests/private-fixtures/benchmark absent" },
    () => {
      const lines = readLines(doc.driveFileId)!;
      const label = readLabel(doc.driveFileId)!;
      const vatRecap: DocumentVatRecapRow[] = doc.modelRows.map((modelRow) => ({
        rateLiteral: modelRow.rate,
        baseLiteral: (modelRow.baseCents / 100).toFixed(2),
        baseCents: modelRow.baseCents,
        vatLiteral: (modelRow.vatCents / 100).toFixed(2),
        vatCents: modelRow.vatCents,
      }));
      const result = settleAdvance({
        lines,
        total: { cents: doc.modelTotalCents, literal: (doc.modelTotalCents / 100).toFixed(2) },
        vatRecap,
        currency: "EUR",
      });
      assert.equal(result.settled, true);
      if (!result.settled) return;

      assert.equal(result.total.cents, doc.supply.total);
      const base = result.supplyRows.reduce((sum, r) => sum + r.baseCents, 0);
      const vat = result.supplyRows.reduce((sum, r) => sum + r.vatCents, 0);
      assert.equal(base, doc.supply.base);
      assert.equal(vat, doc.supply.vat);
      assert.equal(base + vat, doc.supply.total);
      assert.equal(result.advanceDeducted.cents, doc.advance);
      assert.equal(result.amountDue.cents, 0);
      assert.deepEqual(result.advanceDocumentNumbers, doc.documentNumbers);
      assert.ok(result.supplyRows.every((r) => r.baseCents !== 0 || r.vatCents !== 0));

      // The labels are Omega's own booked values. For B1 the label total includes
      // VAT she self-assessed, so only the base is compared; B2 prints its VAT
      // and its total is compared as well.
      if (doc.labelBase !== null) {
        assert.equal(label.vatRecap.reduce((sum, r) => sum + r.baseCents, 0), doc.labelBase);
        assert.equal(base, doc.labelBase);
      }
      if (label.kvDphSection?.toUpperCase() !== "B1") {
        assert.equal(label.amountCents, doc.supply.total);
      }
    },
  );
}

test(
  "private corpus: the 23 % advance settlement cancels to a zero amount due in the text",
  { skip: available ? false : "tests/private-fixtures/benchmark absent" },
  () => {
    const lines = readLines("1yKh4LzDtPVa2iVgfiI1b4s72pUC-VVFi")!;
    const result = settleAdvance({
      lines,
      total: { cents: 0, literal: "0.00" },
      vatRecap: [{ rateLiteral: "23", baseLiteral: "32.51", baseCents: 3251, vatLiteral: "7.48", vatCents: 748 }],
      currency: "EUR",
    });
    assert.equal(result.settled, true);
    if (result.settled) {
      assert.deepEqual(
        result.settlementRows.map((r) => [r.rateLiteral, r.baseCents, r.vatCents]),
        [["23", -3251, -748]],
      );
    }
  },
);
