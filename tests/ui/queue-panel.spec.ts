import { test, expect } from "@playwright/test";
import { build } from "esbuild";

let bundle: string;

const job = (overrides: Record<string, unknown>) => ({
  driveFileId: "doc-a",
  kind: "document",
  companyId: 1,
  companyName: "Delta s.r.o.",
  monthKey: "2026_01",
  fileName: "faktura-a.pdf",
  lane: "read",
  state: "running",
  enqueuedAt: "2026-01-12T10:00:00.000Z",
  startedAt: "2026-01-12T10:00:01.000Z",
  stage: "download",
  stageLabel: "Čítanie · Sťahujem z Drive",
  percent: 2,
  elapsedMs: 4000,
  waitingReason: null,
  ...overrides,
});

const view = {
  services: {
    model: { state: "ok", url: "http://extractor:8080", model: "local", detail: null },
    ocr: { state: "ok", url: "http://ocr:8090", detail: null },
  },
  workerAlive: true,
  workers: 1,
  checkedAt: "2026-01-12T10:00:05.000Z",
  drive: {
    mode: "push",
    modeLabel: "Push zapnutý",
    channelExpiryLabel: "30. 11. 2026 12:00",
    pollLabel: "každých 15 min",
    lastNotificationLabel: "pred 4 min",
    lastSweepLabel: "Drive načítaný pred 4 minútami",
    silent: false,
  },
  concurrency: { read: 3, model: 1 },
  modelSource: "server",
  running: [
    job({}),
    job({
      driveFileId: "doc-b",
      fileName: "faktura-b.pdf",
      lane: "model",
      stage: "model",
      stageLabel: "Model · Model číta text · 0 z 1000 tokenov",
      percent: 40,
    }),
  ],
  waiting: [
    job({
      driveFileId: "doc-c",
      fileName: "faktura-c.pdf",
      lane: "model",
      state: "waiting",
      stage: "queued",
      stageLabel: "Model · V rade",
      startedAt: null,
    }),
  ],
  delayed: [
    job({
      driveFileId: "doc-d",
      fileName: "sken-d.pdf",
      lane: "read",
      state: "delayed",
      stage: "queued",
      stageLabel: "Čítanie · Čaká na službu",
      waitingReason: "OCR is unreachable.",
      startedAt: null,
    }),
  ],
  recent: [
    // Pipeline order is not the order the record lists them in: the panel sorts them.
    finished({
      driveFileId: "doc-r1",
      fileName: "vyuctovanie-a.pdf",
      durationMs: 76_300,
      stages: [
        { stage: "answer", durationMs: 45_400, tokens: 332 },
        { stage: "download", durationMs: 400 },
        { stage: "text", durationMs: 1_200 },
        { stage: "ocr", durationMs: 42_000, pages: 3 },
        { stage: "prompt", durationMs: 28_400, tokens: 1087 },
      ],
    }),
    finished({
      driveFileId: "doc-r2",
      fileName: "pohonne-b.pdf",
      durationMs: 50_000,
      stages: [
        { stage: "download", durationMs: 200 },
        { stage: "text", durationMs: 900 },
        { stage: "prompt", durationMs: 20_000, tokens: 900 },
        { stage: "answer", durationMs: 30_000, tokens: 200 },
      ],
    }),
    // Written before stages were kept: its total is all it has.
    finished({ driveFileId: "doc-r3", fileName: "stary-c.pdf", durationMs: 50_000 }),
  ],
};

function finished(overrides: Record<string, unknown>) {
  return {
    driveFileId: "doc-r",
    kind: "document",
    companyId: 1,
    companyName: "Delta s.r.o.",
    monthKey: "2026_01",
    fileName: "doklad.pdf",
    finishedAt: "2026-01-12T10:05:00.000Z",
    durationMs: 1000,
    outcome: "complete",
    reason: null,
    ...overrides,
  };
}

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { QueuePanel } from "./src/app/queue/queue-panel";
        const view = ${JSON.stringify(view)};
        createRoot(window.document.getElementById("root")).render(<QueuePanel initial={view} />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  // Some modules the panel imports read process.env at load; the browser has none.
  // The live feed (/api/events) does not exist on a blank test page: the panel
  // shows the view it was given, so the feed is a silent stub.
  bundle = [
    "window.process = { env: {} };",
    "window.EventSource = class { addEventListener() {} close() {} };",
    result.outputFiles[0]!.text,
  ].join("\n");
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
});

test("the queue shows the reading lane and the model lane, each with its own jobs", async ({ page }) => {
  const reading = page.getByTestId("queue-lane-read");
  const model = page.getByTestId("queue-lane-model");
  await expect(reading).toBeVisible();
  await expect(model).toBeVisible();

  await expect(reading.getByTestId("queue-running-job")).toHaveCount(1);
  await expect(reading.getByTestId("queue-running-stage")).toHaveText("Čítanie · Sťahujem z Drive");
  await expect(model.getByTestId("queue-running-stage")).toHaveText("Model · Model číta text · 0 z 1000 tokenov");
  await expect(model.getByTestId("queue-waiting-job")).toHaveCount(1);
  await expect(model.getByText("faktura-c.pdf")).toBeVisible();
  await expect(reading.getByText("faktura-c.pdf")).toHaveCount(0);
});

test("a document waiting for OCR says so, in the reading lane's delayed list", async ({ page }) => {
  const delayed = page.getByTestId("queue-delayed-job");
  await expect(delayed).toHaveCount(1);
  await expect(delayed).toContainText("Čítanie · Čaká na službu");
  await expect(delayed).toContainText("OCR is unreachable.");
});

test("the footer names both concurrency limits, and where the model's comes from", async ({ page }) => {
  await expect(page.getByText("READ_CONCURRENCY")).toBeVisible();
  await expect(page.getByText("(podľa -np na serveri)")).toBeVisible();
});

test("a recent document shows its stages in pipeline order, with their time and count", async ({ page }) => {
  const row = page.getByTestId("queue-recent-job").filter({ hasText: "vyuctovanie-a.pdf" });
  await expect(row.getByTestId("queue-recent-stages").locator("li")).toHaveText([
    /^Sťahovanie z Drive 0,4 s$/,
    /^Text PDF 1,2 s$/,
    /^OCR 42,0 s · 3 strany$/,
    /^Model číta text 28,4 s · 1\s087 tokenov$/,
    /^Model píše odpoveď 45,4 s · 332 tokenov$/,
  ]);
});

test("the summary gives the median and the 90th percentile of each stage over the recent list", async ({ page }) => {
  const rows = page.getByTestId("queue-stage-summary-row");
  await expect(rows).toHaveCount(5);
  // Answer: 45.4 s and 30.0 s; the median is their mean, the 90th percentile lies 90 % of the way from 30.0 s to 45.4 s.
  const answer = rows.filter({ hasText: "Model píše odpoveď" });
  await expect(answer).toContainText("37,7 s");
  await expect(answer).toContainText("43,9 s");
  // Download: 0.4 s and 0.2 s.
  await expect(rows.filter({ hasText: "Sťahovanie z Drive" })).toContainText("0,3 s");
  await expect(rows.filter({ hasText: "OCR" })).toContainText("42,0 s");
});

test("a document written before stages were kept shows its total, with no breakdown", async ({ page }) => {
  await expect(page.getByTestId("queue-recent-job")).toHaveCount(3);
  const old = page.getByTestId("queue-recent-job").filter({ hasText: "stary-c.pdf" });
  await expect(old).toContainText("0:50");
  await expect(old.getByTestId("queue-recent-stages")).toHaveCount(0);
});
