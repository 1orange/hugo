import { test } from "node:test";
import assert from "node:assert/strict";
import { isSweepStale, SWEEP_STALE_AFTER_MS } from "../../../src/lib/sweep/stale.ts";

test("isSweepStale is true when no sweep has run", () => {
  assert.equal(isSweepStale(null, Date.now()), true);
});

test("isSweepStale is false inside the freshness window", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  const recent = new Date(now - SWEEP_STALE_AFTER_MS + 1000).toISOString();
  assert.equal(isSweepStale(recent, now), false);
});

test("isSweepStale is true after the freshness window", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  const stale = new Date(now - SWEEP_STALE_AFTER_MS).toISOString();
  assert.equal(isSweepStale(stale, now), true);
});
