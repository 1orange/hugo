import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPdfAccess } from "../../../src/adapters/pdf/pdf-access.ts";
import { readEmbeddedInvoiceXml } from "../../../src/lib/model-extraction/embedded-invoice.ts";
import { runExtractionChecks } from "../../../src/modules/extraction-checks.ts";
import type { BenchmarkLabel } from "../../../src/modules/benchmark-label.ts";

const FIXTURES = path.join(process.cwd(), "tests/private-fixtures/benchmark");

function issuedLabels(): BenchmarkLabel[] {
  if (!fs.existsSync(FIXTURES)) {
    return [];
  }
  return fs
    .readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".json") && name !== "manifest.json")
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as BenchmarkLabel)
    .filter((label) => label.side === "issued" && fs.existsSync(path.join(FIXTURES, `${label.driveFileId}.pdf`)));
}

// Her issued invoices are printed by KROS Omega with the ISDOC embedded; read
// as data, every field her T01 export records must match, with no check raised.
test(
  "the ISDOC in each of her issued invoices matches what she booked in Omega",
  { skip: issuedLabels().length > 0 ? false : "tests/private-fixtures/benchmark absent" },
  async () => {
    const pdfAccess = createPdfAccess();
    for (const label of issuedLabels()) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, `${label.driveFileId}.pdf`)));
      const isdoc = await readEmbeddedInvoiceXml(bytes, pdfAccess);
      assert.ok(isdoc, label.documentNumber ?? label.driveFileId);
      const { payload } = isdoc;
      const name = label.documentNumber ?? label.driveFileId;
      assert.equal(payload.documentNumber, label.documentNumber, name);
      assert.equal(payload.variableSymbol, label.variableSymbol, name);
      assert.equal(payload.issueDate, label.issueDate, name);
      assert.equal(payload.taxableSupplyDate, label.taxableSupplyDate, name);
      assert.equal(payload.dueDate, label.dueDate, name);
      assert.equal(payload.amountCents, label.amountCents, name);
      assert.deepEqual(
        payload.vatRecap.map((row) => [Number(row.rateLiteral), row.baseCents, row.vatCents]),
        label.vatRecap.map((row) => [Number(row.rateLiteral), row.baseCents, row.vatCents]),
        name,
      );
      assert.ok(payload.parties.some((party) => party.ico === label.customer.ico), name);

      const checked = runExtractionChecks({
        payload,
        sourceTextLines: [isdoc.xml],
        monthKey: label.monthKey,
        issuerCountry: "SK",
      });
      const flagged = Object.entries(checked.flags).filter(([key, state]) => key !== "parties" && state === "flagged");
      assert.deepEqual(flagged, [], name);
    }
  },
);
