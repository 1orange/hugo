import { createHttpExtractor } from "../src/adapters/extractor/http-extractor.ts";
import { createStubExtractor } from "../src/adapters/extractor/stub-extractor.ts";
import type { Extractor } from "../src/adapters/extractor/port.ts";
import { createOcr } from "../src/adapters/ocr/create-ocr.ts";
import type { Ocr } from "../src/adapters/ocr/port.ts";
import { groupOcrBoxesIntoLines } from "../src/modules/ocr-lines.ts";
import {
  aggregateBenchmarkScores,
  scoreBenchmarkDocument,
} from "../src/modules/benchmark-scoring.ts";
import {
  BENCHMARK_FIXTURES_DIR,
  BENCHMARK_FIXTURES_MISSING,
  benchmarkFixturesReady,
  loadBenchmarkLabels,
  loadBenchmarkPageImages,
  loadBenchmarkSourceText,
} from "../src/modules/benchmark-fixtures.ts";
import { benchmarkFieldCheckStates } from "../src/modules/extraction-checks-benchmark.ts";
import { runExtractionChecks } from "../src/modules/extraction-checks.ts";
import type { ExtractedPayload } from "../src/modules/document-payload.ts";
import type { CompanyCountry } from "../src/modules/company-profile.ts";

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function issuerCountryFromLabel(label: {
  supplier: { icDph: string | null };
}): CompanyCountry {
  const vat = (label.supplier.icDph ?? "").trim().toUpperCase();
  if (vat.startsWith("CZ")) {
    return "CZ";
  }
  return "SK";
}

function createBenchmarkExtractor(useReal: boolean): {
  extractor: Extractor;
  modeLabel: string;
} {
  if (!useReal) {
    return { extractor: createStubExtractor(), modeLabel: "stub Extractor" };
  }

  const baseUrl = process.env.EXTRACTOR_URL?.trim() ?? "http://127.0.0.1:8080";
  const model = process.env.EXTRACTOR_MODEL?.trim() ?? "local";
  return {
    extractor: createHttpExtractor({
      baseUrl,
      model,
      thinkingEnabled: process.env.EXTRACTOR_THINKING === "true",
    }),
    modeLabel: `HTTP Extractor (${baseUrl}, model=${model}, Docker CPU-only timing)`,
  };
}

async function main(): Promise<void> {
  const useReal = process.argv.includes("--real");
  const fixturesDir = BENCHMARK_FIXTURES_DIR;
  if (!benchmarkFixturesReady(fixturesDir)) {
    console.error(BENCHMARK_FIXTURES_MISSING);
    process.exit(1);
  }

  const labels = loadBenchmarkLabels(fixturesDir);
  if (labels.length === 0) {
    console.error(BENCHMARK_FIXTURES_MISSING);
    process.exit(1);
  }

  const { extractor, modeLabel } = createBenchmarkExtractor(useReal);
  const ocr: Ocr = createOcr(process.env);
  const payloadsByDriveFileId: Record<string, ExtractedPayload> = {};
  const modelDurationsMs: number[] = [];
  const ocrDurationsMs: number[] = [];
  const documentScores = [];

  for (const label of labels) {
    let textLines = loadBenchmarkSourceText(label.driveFileId, fixturesDir);
    if (textLines.length === 0) {
      const images = loadBenchmarkPageImages(label.driveFileId, fixturesDir);
      if (images) {
        const ocrResult = await ocr.recognize({ images });
        ocrDurationsMs.push(ocrResult.durationMs);
        textLines = groupOcrBoxesIntoLines(ocrResult.boxes);
      }
    }
    const result = await extractor.extract({
      driveFileId: label.driveFileId,
      monthKey: label.monthKey,
      textLines,
    });
    const checked = runExtractionChecks({
      payload: result.payload,
      sourceTextLines: textLines,
      monthKey: label.monthKey,
      issuerCountry: issuerCountryFromLabel(label),
    });
    modelDurationsMs.push(result.durationMs);
    payloadsByDriveFileId[label.driveFileId] = checked.payload;
    documentScores.push(
      scoreBenchmarkDocument({
        label,
        payload: checked.payload,
        fieldCheckStates: benchmarkFieldCheckStates(
          checked.flags,
          label,
          checked.payload,
        ),
      }),
    );
  }

  const aggregate = aggregateBenchmarkScores({
    documents: documentScores,
    payloadsByDriveFileId,
  });

  console.log(`Benchmark harness — ${labels.length} documents (${modeLabel})`);
  console.log("");

  for (const document of aggregate.documents) {
    console.log(document.driveFileId);
    for (const field of document.fields) {
      console.log(
        `  ${field.field.padEnd(18)} ${field.outcome.padEnd(16)} expected=${field.expected ?? "—"} actual=${field.actual ?? "—"}`,
      );
    }
    console.log("");
  }

  const bar = aggregate.adoptionBar;
  console.log("Check-state distribution (field outcomes):");
  const outcomeCounts = new Map<string, number>();
  for (const document of aggregate.documents) {
    for (const field of document.fields) {
      outcomeCounts.set(field.outcome, (outcomeCounts.get(field.outcome) ?? 0) + 1);
    }
  }
  for (const [outcome, count] of [...outcomeCounts.entries()].sort()) {
    console.log(`  ${outcome}: ${count}`);
  }
  console.log("");

  console.log("ADR 0017 adoption bar:");
  console.log(
    `  amount wrong while arithmetic passed: ${bar.amountWrongWhileArithmeticPassed} (${bar.passesAmountRule ? "pass" : "fail"})`,
  );
  console.log(
    `  exact or empty-flagged: ${formatRate(bar.exactOrEmptyFlaggedRate)} (${bar.passesAccuracyRule ? "pass" : "fail"}, need ≥ 90%)`,
  );
  console.log(
    `  wrong-but-plausible: ${formatRate(bar.wrongPlausibleRate)} (${bar.passesWrongPlausibleRule ? "pass" : "fail"}, need ≤ 5%)`,
  );
  console.log(`  overall: ${bar.passes ? "PASS" : "FAIL"}`);

  const medianModelMs = median(modelDurationsMs);
  const worstModelMs =
    modelDurationsMs.length === 0 ? 0 : Math.max(...modelDurationsMs);
  const medianOcrMs = median(ocrDurationsMs);
  const worstOcrMs =
    ocrDurationsMs.length === 0 ? 0 : Math.max(...ocrDurationsMs);
  if (useReal) {
    console.log(
      `  median OCR time (image docs): ${ocrDurationsMs.length === 0 ? "—" : `${medianOcrMs.toFixed(0)} ms`}`,
    );
    if (ocrDurationsMs.length > 0) {
      console.log(`  worst OCR time: ${worstOcrMs.toFixed(0)} ms`);
    }
    console.log(
      `  median model time per document: ${medianModelMs.toFixed(0)} ms (Docker CPU-only — not native Metal)`,
    );
    console.log(`  worst model time per document: ${worstModelMs.toFixed(0)} ms`);
    const passesTime = medianModelMs <= 60_000;
    console.log(`  time budget ≤ 60 s (model only): ${passesTime ? "pass" : "fail"}`);
  } else {
    console.log(`  median model time per document: ${medianModelMs.toFixed(0)} ms (stub)`);
    if (ocrDurationsMs.length > 0) {
      console.log(`  median OCR time: ${medianOcrMs.toFixed(0)} ms (stub)`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
