import fs from "node:fs";
import path from "node:path";
import {
  parseBenchmarkLabel,
  serializeBenchmarkLabel,
  type BenchmarkImportManifest,
  type BenchmarkLabel,
} from "./benchmark-label";
import {
  mergeRegisterRows,
  parseVatRegisterDeductionLines,
  registerRowMatchKeys,
} from "./vat-register-import";
import {
  parseOmegaT01IssuedInvoices,
  skCalendarRawToIso,
  type OmegaT01IssuedInvoice,
} from "./omega-t01-import";

export const BENCHMARK_FIXTURES_DIR = path.join(
  process.cwd(),
  "tests/private-fixtures/benchmark",
);

export const BENCHMARK_FIXTURES_MISSING =
  "Benchmark fixtures are absent. Import them first:\n" +
  "  node --import tsx scripts/import-benchmark-labels.ts \\\n" +
  "    --t01 <omega-t01-export.txt> \\\n" +
  "    --vat-register <evidencia-dph-odpoctanie.pdf> \\\n" +
  "    --manifest <manifest.json> \\\n" +
  "    --out tests/private-fixtures/benchmark";

export function benchmarkFixturesReady(dir: string = BENCHMARK_FIXTURES_DIR): boolean {
  if (!fs.existsSync(dir)) {
    return false;
  }
  return fs
    .readdirSync(dir)
    .some((name) => name.endsWith(".json") && name !== "manifest.json");
}

export function loadBenchmarkManifest(dir: string = BENCHMARK_FIXTURES_DIR): BenchmarkImportManifest | null {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BenchmarkImportManifest;
  } catch {
    return null;
  }
}

export function loadBenchmarkLabels(dir: string = BENCHMARK_FIXTURES_DIR): BenchmarkLabel[] {
  const labels: BenchmarkLabel[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "manifest.json") {
      continue;
    }
    const parsed = parseBenchmarkLabel(fs.readFileSync(path.join(dir, name), "utf8"));
    if (parsed) {
      labels.push(parsed);
    }
  }
  labels.sort((left, right) => left.driveFileId.localeCompare(right.driveFileId));
  return labels;
}

export function loadBenchmarkSourceText(
  driveFileId: string,
  dir: string = BENCHMARK_FIXTURES_DIR,
): string[] {
  const textPath = path.join(dir, `${driveFileId}.txt`);
  if (!fs.existsSync(textPath)) {
    return [];
  }
  return fs.readFileSync(textPath, "utf8").split(/\r?\n/);
}

const BENCHMARK_SOURCE_TYPES = [
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".heic", "image/heic"],
] as const;

/**
 * The document itself (`<driveFileId>.pdf`, `.jpg`, …), read by the harness
 * as the app reads it. A `.txt` with the source text is the fallback for a
 * label whose file is not in the fixtures.
 */
export function loadBenchmarkSourceFile(
  driveFileId: string,
  dir: string = BENCHMARK_FIXTURES_DIR,
): { mimeType: string; bytes: Uint8Array } | null {
  for (const [extension, mimeType] of BENCHMARK_SOURCE_TYPES) {
    const filePath = path.join(dir, `${driveFileId}${extension}`);
    if (fs.existsSync(filePath)) {
      return { mimeType, bytes: new Uint8Array(fs.readFileSync(filePath)) };
    }
  }
  return null;
}

function issuedLabelFromT01(
  invoice: OmegaT01IssuedInvoice,
  manifestEntry: BenchmarkImportManifest["issued"][number],
  monthKey: string,
): BenchmarkLabel {
  return {
    driveFileId: manifestEntry.driveFileId,
    monthKey,
    side: "issued",
    folderSlot: manifestEntry.folderSlot ?? "01 Vystavené faktúry",
    kvDphSection: null,
    docTypeHint: "invoice",
    documentNumber: invoice.documentNumber,
    variableSymbol: invoice.variableSymbol,
    issueDate: skCalendarRawToIso(invoice.issueDateRaw),
    taxableSupplyDate: skCalendarRawToIso(invoice.taxableSupplyDateRaw),
    dueDate: skCalendarRawToIso(invoice.dueDateRaw),
    currency: invoice.currency,
    amountCents: invoice.amountCents,
    amountLiteral: invoice.amountLiteral,
    vatRecap: invoice.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      baseCents: row.baseCents,
      vatLiteral: row.vatLiteral,
      vatCents: row.vatCents,
    })),
    supplier: { name: null, ico: null, dic: null, icDph: null },
    customer: {
      name: invoice.customerName,
      ico: invoice.customerIco,
      dic: null,
      icDph: null,
    },
  };
}

function receivedLabelFromRegister(
  row: ReturnType<typeof mergeRegisterRows>[number],
  manifestEntry: BenchmarkImportManifest["received"][number],
  monthKey: string,
): BenchmarkLabel {
  const amountCents = row.vatRecap.reduce(
    (sum, entry) => sum + entry.baseCents + entry.vatCents,
    0,
  );
  const docTypeHint = manifestEntry.docTypeHint ?? (row.evidenceCode === "IDk" ? "receipt" : "invoice");
  return {
    driveFileId: manifestEntry.driveFileId,
    monthKey,
    side: "received",
    folderSlot: manifestEntry.folderSlot ?? null,
    kvDphSection: row.kvDphSection,
    docTypeHint,
    // A receipt's row (IDk) carries only her own number, IDk26007: KV DPH
    // section B3 reports receipts without the supplier's, and the Zamkni
    // receipt prints "Doklad číslo 370".
    documentNumber: row.evidenceCode === "IDk" ? null : row.supplierDocumentNumber,
    // Her VAT register records neither: its dates are when the tax arose and
    // when she deducted it. Copying the document number and the taxable date
    // in marked the model wrong for reading them off the invoice — UPC prints
    // VS 9643266 for document 218904645, issued 13.5 for a supply on 11.5.
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: skCalendarRawToIso(row.taxableSupplyDateRaw),
    dueDate: null,
    currency: "EUR",
    amountCents,
    amountLiteral: (amountCents / 100).toFixed(2),
    vatRecap: row.vatRecap.map((entry) => ({ ...entry })),
    supplier: {
      name: row.partnerShortName,
      ico: null,
      dic: null,
      icDph: row.supplierIcDph,
    },
    customer: { name: null, ico: null, dic: null, icDph: null },
  };
}

export function buildBenchmarkLabels(input: {
  t01ExportText: string;
  vatRegisterLines: string[];
  manifest: BenchmarkImportManifest;
}): BenchmarkLabel[] {
  const issuedByNumber = new Map(
    parseOmegaT01IssuedInvoices(input.t01ExportText).map((row) => [row.documentNumber, row]),
  );
  const registerByKey = new Map<string, ReturnType<typeof mergeRegisterRows>[number]>();
  for (const row of mergeRegisterRows(parseVatRegisterDeductionLines(input.vatRegisterLines))) {
    for (const key of registerRowMatchKeys(row)) {
      registerByKey.set(key, row);
    }
  }

  const labels: BenchmarkLabel[] = [];
  for (const entry of input.manifest.issued) {
    const invoice = issuedByNumber.get(entry.documentNumber);
    if (!invoice) {
      throw new Error(`T01 export has no issued invoice ${entry.documentNumber}.`);
    }
    labels.push(issuedLabelFromT01(invoice, entry, input.manifest.monthKey));
  }

  for (const entry of input.manifest.received) {
    const row = registerByKey.get(entry.matchKey);
    if (!row) {
      throw new Error(`VAT register has no row matching ${entry.matchKey}.`);
    }
    labels.push(receivedLabelFromRegister(row, entry, input.manifest.monthKey));
  }

  return labels;
}

export function writeBenchmarkLabels(
  labels: BenchmarkLabel[],
  outDir: string,
  manifest: BenchmarkImportManifest,
): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const label of labels) {
    fs.writeFileSync(
      path.join(outDir, `${label.driveFileId}.json`),
      `${serializeBenchmarkLabel(label)}\n`,
    );
  }
}
