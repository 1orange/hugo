import fs from "node:fs";
import { createHttpExtractor } from "../src/adapters/extractor/http-extractor.ts";
import { createStubExtractor } from "../src/adapters/extractor/stub-extractor.ts";
import type { Extractor } from "../src/adapters/extractor/port.ts";
import { createOcr } from "../src/adapters/ocr/create-ocr.ts";
import type { Ocr } from "../src/adapters/ocr/port.ts";
import { createPdfAccess } from "../src/adapters/pdf/pdf-access.ts";
import { modelTextForDocument } from "../src/lib/model-extraction/model-text.ts";
import { isExtractorUnreachableError } from "../src/lib/model-extraction/process-model-extraction.ts";
import {
  aggregateBenchmarkScores,
  scoreBenchmarkDocument,
} from "../src/modules/benchmark-scoring.ts";
import {
  BENCHMARK_FIXTURES_DIR,
  BENCHMARK_FIXTURES_MISSING,
  benchmarkFixturesReady,
  loadBenchmarkLabels,
  loadBenchmarkManifest,
  loadBenchmarkSourceFile,
  loadBenchmarkSourceText,
} from "../src/modules/benchmark-fixtures.ts";
import { benchmarkFieldCheckStates } from "../src/modules/extraction-checks-benchmark.ts";
import { runExtractionChecks } from "../src/modules/extraction-checks.ts";
import type { ExtractedPayload, ModelExtractedPayload } from "../src/modules/document-payload.ts";
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
  const timeoutMs = Number(process.env.EXTRACTOR_TIMEOUT_MS);
  return {
    extractor: createHttpExtractor({
      baseUrl,
      model,
      thinkingEnabled: process.env.EXTRACTOR_THINKING === "true",
      ...(timeoutMs > 0 ? { timeoutMs } : {}),
    }),
    modeLabel: `HTTP Extractor (${baseUrl}, model=${model}, Docker CPU-only timing)`,
  };
}

async function main(): Promise<void> {
  const useReal = process.argv.includes("--real");
  const fixturesDir = process.env.BENCHMARK_FIXTURES_DIR || BENCHMARK_FIXTURES_DIR;
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
  const companyIco = loadBenchmarkManifest(fixturesDir)?.companyIco ?? null;
  const ocr: Ocr = createOcr(process.env);
  const payloadsByDriveFileId: Record<string, ExtractedPayload> = {};
  const modelDurationsMs: number[] = [];
  const completionTokens: number[] = [];
  const ocrDurationsMs: number[] = [];
  const skippedWithoutOcr: string[] = [];
  const withoutText: string[] = [];
  const failedByModel: string[] = [];
  // Per document: what the model read, what it answered, what it cost.
  const perDocument: Record<
    string,
    {
      lines: string[];
      payload: ExtractedPayload;
      modelMs?: number;
      tokens?: number;
      ocrMs?: number;
      failure?: string;
    }
  > = {};
  const documentScores = [];
  const pdfAccess = createPdfAccess();
  // `--rescore <row>.payloads.json`: a recorded row's answers, scored as the
  // scoring is now — no model, no OCR. The normalisers ran when it was recorded.
  const rescoreIndex = process.argv.indexOf("--rescore");
  const rescorePath = rescoreIndex >= 0 ? process.argv[rescoreIndex + 1] : undefined;
  const saved: typeof perDocument | null = rescorePath
    ? (JSON.parse(fs.readFileSync(rescorePath, "utf8")) as typeof perDocument)
    : null;

  for (const label of labels) {
    if (saved) {
      const entry = saved[label.driveFileId];
      if (!entry) {
        // The recorded run had no OCR for it.
        skippedWithoutOcr.push(label.driveFileId);
        continue;
      }
      perDocument[label.driveFileId] = entry;
      if (entry.ocrMs !== undefined) {
        ocrDurationsMs.push(entry.ocrMs);
      }
      if (entry.modelMs !== undefined) {
        modelDurationsMs.push(entry.modelMs);
      }
      if (entry.tokens !== undefined) {
        completionTokens.push(entry.tokens);
      }
      if (entry.failure !== undefined || entry.lines.length === 0) {
        if (entry.failure !== undefined) {
          failedByModel.push(`${label.driveFileId}: ${entry.failure}`);
        } else {
          withoutText.push(label.driveFileId);
        }
        payloadsByDriveFileId[label.driveFileId] = {};
        documentScores.push(scoreBenchmarkDocument({ label, payload: {}, companyIco }));
        continue;
      }
      const { fieldChecks, ...payload } = entry.payload as ModelExtractedPayload;
      payloadsByDriveFileId[label.driveFileId] = payload;
      documentScores.push(
        scoreBenchmarkDocument({
          label,
          payload,
          fieldCheckStates: fieldChecks
            ? benchmarkFieldCheckStates(fieldChecks, label, payload, companyIco)
            : undefined,
          companyIco,
        }),
      );
      continue;
    }
    // The document's own file, read as the app reads it for the model.
    const source = loadBenchmarkSourceFile(label.driveFileId, fixturesDir);
    let textLines: string[];
    let ocrMs: number | undefined;
    if (source) {
      const text = await modelTextForDocument({
        mimeType: source.mimeType,
        fileBytes: source.bytes,
        pdfAccess,
        ocr,
      });
      if (!text.ok) {
        // Text invoices can be benchmarked without the OCR service.
        skippedWithoutOcr.push(label.driveFileId);
        continue;
      }
      if (text.ocrDurationMs !== null) {
        ocrDurationsMs.push(text.ocrDurationMs);
        ocrMs = text.ocrDurationMs;
      }
      textLines = text.lines;
    } else {
      textLines = loadBenchmarkSourceText(label.driveFileId, fixturesDir);
    }
    if (textLines.length === 0) {
      // The app marks it failed and she types it: every field empty.
      withoutText.push(label.driveFileId);
      perDocument[label.driveFileId] = { lines: [], payload: {}, ocrMs };
      payloadsByDriveFileId[label.driveFileId] = {};
      documentScores.push(scoreBenchmarkDocument({ label, payload: {}, companyIco }));
      continue;
    }
    const extractStarted = Date.now();
    let result: Awaited<ReturnType<Extractor["extract"]>>;
    try {
      result = await extractor.extract({
        driveFileId: label.driveFileId,
        monthKey: label.monthKey,
        textLines,
      });
    } catch (error) {
      // An extractor that is down stops the run; a document the model could
      // not finish is failed, as the app fails it: every field empty.
      if (isExtractorUnreachableError(error)) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      failedByModel.push(`${label.driveFileId}: ${reason}`);
      modelDurationsMs.push(Date.now() - extractStarted);
      perDocument[label.driveFileId] = {
        lines: textLines,
        payload: {},
        modelMs: Date.now() - extractStarted,
        ocrMs,
        failure: reason,
      };
      payloadsByDriveFileId[label.driveFileId] = {};
      documentScores.push(scoreBenchmarkDocument({ label, payload: {}, companyIco }));
      continue;
    }
    const checked = runExtractionChecks({
      payload: result.payload,
      sourceTextLines: textLines,
      monthKey: label.monthKey,
      issuerCountry: issuerCountryFromLabel(label),
    });
    modelDurationsMs.push(result.durationMs);
    if (result.completionTokens !== undefined) {
      completionTokens.push(result.completionTokens);
    }
    payloadsByDriveFileId[label.driveFileId] = checked.payload;
    perDocument[label.driveFileId] = {
      lines: textLines,
      payload: { ...checked.payload, fieldChecks: checked.flags },
      modelMs: result.durationMs,
      tokens: result.completionTokens,
      ocrMs,
    };
    documentScores.push(
      scoreBenchmarkDocument({
        label,
        payload: checked.payload,
        fieldCheckStates: benchmarkFieldCheckStates(
          checked.flags,
          label,
          checked.payload,
          companyIco,
        ),
        companyIco,
      }),
    );
  }

  // Answers saved beside the log, to re-score or inspect without the model.
  const payloadsOut = process.env.BENCHMARK_PAYLOADS_OUT?.trim();
  if (payloadsOut && !saved) {
    fs.writeFileSync(payloadsOut, `${JSON.stringify(perDocument, null, 2)}\n`);
  }

  const aggregate = aggregateBenchmarkScores({
    documents: documentScores,
    payloadsByDriveFileId,
  });

  console.log(
    `Benchmark harness — ${labels.length} documents (${rescorePath ? `re-scored from ${rescorePath}` : modeLabel})`,
  );
  if (skippedWithoutOcr.length > 0) {
    console.log(
      `  skipped ${skippedWithoutOcr.length} documents that need OCR: OCR_URL not set or unreachable`,
    );
  }
  if (withoutText.length > 0) {
    console.log(`  ${withoutText.length} documents gave no text: scored as all fields empty`);
  }
  for (const failure of failedByModel) {
    console.log(`  failed, scored as all fields empty — ${failure}`);
  }
  console.log("");

  for (const document of aggregate.documents) {
    console.log(document.driveFileId);
    const cost = perDocument[document.driveFileId];
    if (cost?.modelMs !== undefined) {
      console.log(`  model ${cost.modelMs} ms${cost.tokens !== undefined ? `, ${cost.tokens} tokens` : ""}`);
    }
    for (const field of document.fields) {
      console.log(
        `  ${field.field.padEnd(18)} ${field.outcome.padEnd(16)} expected=${field.expected ?? "—"} actual=${field.actual ?? "—"}${field.note ? `  (${field.note})` : ""}`,
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
  // A re-scored row reports the timings recorded by its real run.
  if (useReal || saved) {
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
    console.log(
      `  median completion tokens per document: ${completionTokens.length === 0 ? "—" : median(completionTokens).toFixed(0)} (thinking shows here)`,
    );
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
