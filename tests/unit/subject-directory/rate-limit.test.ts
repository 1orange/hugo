import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import { rateLimitPauseMs } from "../../../src/lib/worker/subject-worker.ts";

test("the limiter says how long until its next slot, from the oldest lookup in the minute", () => {
  let now = 1_000_000;
  const limiter = createLookupRateLimiter({ perMinute: 2, now: () => now });
  assert.equal(limiter.msUntilFree(), 0);
  assert.equal(limiter.tryTake(), true);
  now += 10_000;
  assert.equal(limiter.tryTake(), true);
  assert.equal(limiter.tryTake(), false);
  assert.equal(limiter.msUntilFree(), 50_000, "the first lookup leaves the window in 50 s");
  now += 50_000;
  assert.equal(limiter.msUntilFree(), 0);
  assert.equal(limiter.tryTake(), true);
});

test("the worker pauses at least a second and at most a minute", () => {
  assert.equal(rateLimitPauseMs(0), 1_000);
  assert.equal(rateLimitPauseMs(12_345.2), 12_346);
  assert.equal(rateLimitPauseMs(5 * 60_000), 60_000);
});
