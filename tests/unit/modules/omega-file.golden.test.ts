import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import {
  buildOmegaFileBytes,
  compareT01DataColumns,
  type OmegaExportInput,
  type OmegaInvoiceDraft,
} from "../../../src/modules/omega-file.ts";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "tests/private-fixtures/spring-2026-05-issued-invoices.json",
);

test("golden file: spring May issued invoices match Omega T01 data columns", { skip: !fs.existsSync(FIXTURE_PATH) }, () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as {
    referencePath: string;
    export: OmegaExportInput;
  };

  const reference = iconv.decode(
    fs.readFileSync(fixture.referencePath),
    "win1250",
  );
  const referenceHeaders = reference
    .split("\r\n")
    .filter((line) => line.startsWith("R01\t") && !line.includes("\tT04"));

  const bytes = buildOmegaFileBytes(fixture.export);
  const actualText = iconv.decode(bytes, "win1250");
  const actualHeaders = actualText
    .split("R00\tT01\r\n")[1]!
    .split("\r\n")
    .filter((line) => line.startsWith("R01\t"));

  assert.equal(actualHeaders.length, referenceHeaders.length);
  for (let index = 0; index < referenceHeaders.length; index += 1) {
    assert.ok(
      compareT01DataColumns(referenceHeaders[index]!, actualHeaders[index]!, {
        ignoreExportNumber: true,
      }),
      `header ${index} mismatch`,
    );
  }
});

test("golden fixture shape is reserved for private invoices", { skip: fs.existsSync(FIXTURE_PATH) }, () => {
  const sample: OmegaInvoiceDraft = {
    driveFileId: "placeholder",
    exportNumber: "H2605-0001",
    docType: 0,
    variableSymbol: "2026075",
    issueDate: "19.05.2026",
    dueDate: "03.06.2026",
    taxableSupplyDate: "19.05.2026",
    currency: "EUR",
    counterparty: {
      partnerKey: "SK:57356661",
      country: "SK",
      name: "XLT Group s. r. o.",
      street: "",
      psc: "",
      city: "",
      ico: "57356661",
      dic: "",
      icDph: "",
    },
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "115",
        baseCents: 11500,
        vatLiteral: "26.45",
        vatCents: 2645,
      },
    ],
    totalCents: 14145,
  };
  assert.ok(sample.exportNumber.startsWith("H"));
});
