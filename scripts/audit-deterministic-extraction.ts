import fs from "node:fs";
import path from "node:path";
import { createPdfAccess } from "../src/adapters/pdf/pdf-access.ts";
import { createOcr } from "../src/adapters/ocr/create-ocr.ts";
import { modelTextForDocument } from "../src/lib/model-extraction/model-text.ts";
import { groupOcrBoxesIntoLines } from "../src/modules/ocr-lines.ts";
import type { Ocr } from "../src/adapters/ocr/port.ts";
import { parseDeterministicInvoice } from "../src/modules/deterministic-invoice.ts";

async function main() {
  const input = process.argv[2];
  const out = process.argv[3];
  if (!input || !out) throw new Error("Usage: audit-deterministic-extraction.ts INPUT_DIRECTORY PRIVATE_OUTPUT_DIRECTORY");
  fs.mkdirSync(out, { recursive: true });
  const pdfAccess = createPdfAccess();
  const rawOcr = createOcr(process.env);
  let boxes: Awaited<ReturnType<Ocr["recognize"]>>["boxes"] = [];
  const ocr: Ocr = { async recognize(input) { const result = await rawOcr.recognize(input); boxes = result.boxes; return result; } };
  const files = fs.readdirSync(input).filter(name => name.toLowerCase().endsWith(".pdf")).sort();
  const records: unknown[] = [];
  let fromOcr = 0, failures = 0, totals = 0, recaps = 0, partyIds = 0;
  const durations: number[] = [];
  for (const [index, filename] of files.entries()) {
    boxes = [];
    const started = performance.now();
    try {
      const text = await modelTextForDocument({mimeType: "application/pdf", fileBytes: new Uint8Array(fs.readFileSync(path.join(input, filename))), pdfAccess, ocr});
      if (!text.ok) throw new Error("OCR service unreachable; no accuracy conclusion can be drawn");
      if (!text.lines.length) throw new Error("No text recovered");
      const rows = boxes.length ? groupOcrBoxesIntoLines(boxes) : await pdfAccess.extractTextLines(new Uint8Array(fs.readFileSync(path.join(input, filename))), {maxPages: 5, order: "rows"});
      const parsedAt = performance.now();
      const payload = parseDeterministicInvoice(rows);
      const parseMs = performance.now() - parsedAt;
      const totalMs = performance.now() - started;
      durations.push(totalMs);
      if (text.source === "ocr") fromOcr++;
      if (payload.amountCents !== null) totals++;
      if (payload.vatRecap.length) recaps++;
      if (payload.parties.some(p => p.ico || p.icDph)) partyIds++;
      records.push({filename, source: text.source, lines: rows, readingLines: text.lines, boxes, payload, ocrMs: text.ocrDurationMs, parseMs, totalMs, verified: false});
    } catch (error) {
      failures++;
      records.push({filename, error: error instanceof Error ? error.message : String(error)});
    }
    fs.writeFileSync(path.join(out, "unverified-extractions.json"), JSON.stringify(records, null, 2) + "\n");
    console.log(`Processed ${index + 1}/${files.length}; no labels: coverage only`);
  }
  durations.sort((a,b) => a-b);
  const middle = Math.floor(durations.length / 2);
  const medianMs = durations.length ? durations.length % 2 ? durations[middle]! : (durations[middle-1]!+durations[middle]!)/2 : null;
  const summary = {documents: files.length, fromOcr, failures, documentsWithTotal: totals, documentsWithVatRecap: recaps, documentsWithPartyIdentifier: partyIds, medianTotalMs: medianMs, accuracy: "unmeasured: no verified labels", trainingReady: false};
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
