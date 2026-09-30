import { test } from "node:test";
import assert from "node:assert/strict";
import type { PdfPageImage } from "../../../src/adapters/pdf/port.ts";
import type { CashDiscoveryDeps } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { instrumentDeps, ProgressReporter } from "../../../src/lib/extraction-queue/progress.ts";

// The wrapper once listed only the PDF adapter's older methods: pages were
// never drawn in the app, and garbled invoices failed there while they read
// in tests.
test("a job's adapters pass page drawing through, reporting the stage", async () => {
  const drawn: PdfPageImage = { kind: "encoded", bytes: new Uint8Array([1]) };
  const stages: string[] = [];
  const reporter = new ProgressReporter((progress) => stages.push(progress.stage));
  const deps = instrumentDeps(
    {
      pdfAccess: {
        async extractTextLines() {
          return [];
        },
        async extractAttachments() {
          return [];
        },
        async extractPageImages() {
          return [];
        },
        async renderPages() {
          return [drawn];
        },
      },
    } as unknown as CashDiscoveryDeps,
    reporter,
  );
  assert.deepEqual(await deps.pdfAccess.renderPages(new Uint8Array([0]), { maxPages: 1, longSidePx: 100 }), [drawn]);
  assert.equal(reporter.current.stage, "images");
});
