import fs from "node:fs";
import path from "node:path";
import { createPdfAccess } from "../src/adapters/pdf/pdf-access.ts";
import { type BenchmarkImportManifest } from "../src/modules/benchmark-label.ts";
import {
  BENCHMARK_FIXTURES_DIR,
  buildBenchmarkLabels,
  writeBenchmarkLabels,
} from "../src/modules/benchmark-fixtures.ts";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const t01Path = readArg("--t01");
  const vatRegisterPath = readArg("--vat-register");
  const manifestPath = readArg("--manifest");
  const outDir = path.resolve(readArg("--out") ?? BENCHMARK_FIXTURES_DIR);

  if (!t01Path || !vatRegisterPath || !manifestPath) {
    console.error(
      "Usage: node --import tsx scripts/import-benchmark-labels.ts \\\n" +
        "  --t01 <omega-t01-export.txt> \\\n" +
        "  --vat-register <evidencia-dph-odpoctanie.pdf> \\\n" +
        "  --manifest <manifest.json> \\\n" +
        "  [--out tests/private-fixtures/benchmark]",
    );
    process.exit(1);
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(manifestPath), "utf8"),
  ) as BenchmarkImportManifest;

  const t01ExportText = fs.readFileSync(path.resolve(t01Path), "utf8");
  const pdfBytes = new Uint8Array(fs.readFileSync(path.resolve(vatRegisterPath)));
  const pdfAccess = createPdfAccess();
  const vatRegisterLines = await pdfAccess.extractTextLines(pdfBytes);

  const labels = buildBenchmarkLabels({
    t01ExportText,
    vatRegisterLines,
    manifest,
  });

  writeBenchmarkLabels(labels, outDir, manifest);
  console.log(`Wrote ${labels.length} benchmark labels to ${outDir}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
