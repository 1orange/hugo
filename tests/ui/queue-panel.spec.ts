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
  recent: [],
};

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
