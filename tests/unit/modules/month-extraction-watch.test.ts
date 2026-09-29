import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liveExtractionByFile,
  refreshReason,
  type WatchedQueue,
} from "../../../src/modules/month-extraction-watch.ts";

const MONTH = { companyId: 2, monthKey: "2026_07" };
const job = (driveFileId: string, month = MONTH) => ({ driveFileId, ...month });
const ready = { model: { state: "ok" }, ocr: { state: "ok" } };

function queue(parts: Partial<WatchedQueue>): WatchedQueue {
  return { running: [], waiting: [], delayed: [], recent: [], services: ready, ...parts };
}

test("a document read since the screen rendered makes it stale", () => {
  const reason = refreshReason({
    ...MONTH,
    queue: queue({ recent: [{ ...job("a"), outcome: "complete" }] }),
    pendingFileIds: ["a", "b"],
    wereServicesReady: true,
  });
  assert.equal(reason, "finished");
});

test("while the month's documents are queued nothing is stale", () => {
  const reason = refreshReason({
    ...MONTH,
    queue: queue({
      running: [{ ...job("a"), percent: 40, stageLabel: "Model číta text" }],
      waiting: [job("b")],
      // Another company's document finishing is not this screen's news.
      recent: [{ ...job("x", { companyId: 1, monthKey: "2026_07" }), outcome: "complete" }],
    }),
    pendingFileIds: ["a", "b"],
    wereServicesReady: true,
  });
  assert.equal(reason, null);
});

test("a file queued again is not read from its previous result", () => {
  const reason = refreshReason({
    ...MONTH,
    queue: queue({
      running: [{ ...job("a"), percent: 10, stageLabel: "Sťahujem z Drive" }],
      recent: [{ ...job("a"), outcome: "failed" }],
    }),
    pendingFileIds: ["a"],
    wereServicesReady: true,
  });
  assert.equal(reason, null);
});

test("a model that finished loading queues what waited for it", () => {
  const waitedQueue = queue({ delayed: [job("a")] });
  assert.equal(
    refreshReason({ ...MONTH, queue: waitedQueue, pendingFileIds: ["a"], wereServicesReady: false }),
    "service-recovered",
  );
});

test("documents waiting for a model that is down are not stale", () => {
  const down = queue({
    delayed: [job("a")],
    services: { model: { state: "down" }, ocr: { state: "ok" } },
  });
  assert.equal(refreshReason({ ...MONTH, queue: down, pendingFileIds: ["a"], wereServicesReady: false }), null);
});

test("pending documents the queue does not hold, with the services ready, are idle", () => {
  assert.equal(
    refreshReason({ ...MONTH, queue: queue({}), pendingFileIds: ["a"], wereServicesReady: true }),
    "idle",
  );
  assert.equal(refreshReason({ ...MONTH, queue: queue({}), pendingFileIds: [], wereServicesReady: true }), null);
});

test("each file shows how far it is, where it waits, or what it waits for", () => {
  const live = liveExtractionByFile(
    queue({
      running: [{ ...job("a"), percent: 72, stageLabel: "Model píše odpoveď · 52 tokenov" }],
      waiting: [job("x", { companyId: 1, monthKey: "2026_06" }), job("b")],
      delayed: [job("c")],
      services: { model: { state: "loading" }, ocr: { state: "ok" } },
    }),
    MONTH.companyId,
    MONTH.monthKey,
  );
  assert.deepEqual(live.get("a"), { state: "running", percent: 72, stageLabel: "Model píše odpoveď · 52 tokenov" });
  assert.deepEqual(live.get("b"), { state: "waiting", position: 2 });
  assert.deepEqual(live.get("c"), { state: "blocked", label: "Čaká, kým sa model načíta" });
  assert.equal(live.has("x"), false);
});
