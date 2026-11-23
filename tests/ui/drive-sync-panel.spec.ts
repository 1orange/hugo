import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

let bundle: string;

const idle = {
  services: {
    model: { state: "ok", url: "http://extractor:8080", model: "local", detail: null },
    ocr: { state: "ok", url: "http://ocr:8090", detail: null },
  },
  workerAlive: true,
  workers: 1,
  checkedAt: "2026-01-12T10:00:05.000Z",
  concurrency: { read: 3, model: 1 },
  modelSource: "server",
  running: [],
  waiting: [],
  delayed: [],
  recent: [],
};

const pushOn = {
  mode: "push",
  modeLabel: "Push zapnutý",
  channelExpiryLabel: "30. 11. 2026 12:00",
  pollLabel: "každých 15 min",
  lastNotificationLabel: "pred 4 min",
  lastSweepLabel: "Drive načítaný pred 4 minútami",
  silent: false,
};

const pollOnly = {
  mode: "poll",
  modeLabel: "Iba pravidelná kontrola každých 15 min",
  channelExpiryLabel: null,
  pollLabel: "každých 15 min",
  lastNotificationLabel: "zatiaľ žiadna",
  lastSweepLabel: "Drive načítaný pred 4 minútami",
  silent: false,
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
        const view = (window as unknown as { __queueView: never }).__queueView;
        createRoot(window.document.getElementById("root")!).render(<QueuePanel initial={view} />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = [
    "window.process = { env: {} };",
    "window.EventSource = class { addEventListener() {} close() {} };",
    result.outputFiles[0]!.text,
  ].join("\n");
});

/** The queue screen with one Drive panel state; the view is set before the bundle runs. */
async function openQueue(page: Page, drive: Record<string, unknown>) {
  const view = { ...idle, drive };
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: `window.__queueView = ${JSON.stringify(view)};\n${bundle}` });
}

test("with a webhook and a channel the panel says push is on, with the channel's expiry", async ({ page }) => {
  await openQueue(page, pushOn);
  const panel = page.getByTestId("queue-drive");
  await expect(panel.getByTestId("queue-drive-mode")).toHaveText("Push zapnutý");
  await expect(panel.getByTestId("queue-drive-expiry")).toHaveText("30. 11. 2026 12:00");
  await expect(panel.getByTestId("queue-drive-notification")).toHaveText("pred 4 min");
  await expect(panel.getByTestId("queue-drive-poll")).toHaveText("každých 15 min");
  await expect(page.getByTestId("queue-drive-silent")).toHaveCount(0);
});

test("without a webhook the panel is poll only, and has no channel expiry", async ({ page }) => {
  await openQueue(page, pollOnly);
  const panel = page.getByTestId("queue-drive");
  await expect(panel.getByTestId("queue-drive-mode")).toHaveText("Iba pravidelná kontrola každých 15 min");
  await expect(panel.getByTestId("queue-drive-expiry")).toHaveCount(0);
  await expect(panel.getByTestId("queue-drive-notification")).toHaveText("zatiaľ žiadna");
});

test("a silent webhook is said so, with the reason in Slovak", async ({ page }) => {
  await openQueue(page, { ...pushOn, lastNotificationLabel: "21. 11. 2026 10:00", silent: true });
  const warning = page.getByTestId("queue-drive-silent");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("viac ako 24 hodín");
});
