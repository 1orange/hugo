import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyedQueue } from "../../../src/lib/extraction-queue/keyed-queue.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a key waiting or running is not queued twice", async () => {
  const started: string[] = [];
  const gate = deferred();
  const queue = new KeyedQueue<string>(async (job) => {
    started.push(job);
    await gate.promise;
  }, 1);

  assert.equal(queue.enqueue("a", "a"), true);
  assert.equal(queue.enqueue("b", "b"), true);
  // "a" is running, "b" waiting: a re-render enqueues both again.
  assert.equal(queue.enqueue("a", "a"), false);
  assert.equal(queue.enqueue("b", "b"), false);
  gate.resolve();
  await queue.onIdle();
  assert.deepEqual(started, ["a", "b"]);
  // Once done, a key may be queued again.
  assert.equal(queue.enqueue("a", "a"), true);
  await queue.onIdle();
  assert.deepEqual(started, ["a", "b", "a"]);
});

test("no more jobs run at once than the concurrency", async () => {
  let running = 0;
  let peak = 0;
  const queue = new KeyedQueue<number>(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
  }, 2);
  for (let index = 0; index < 6; index += 1) {
    queue.enqueue(String(index), index);
  }
  await queue.onIdle();
  assert.equal(peak, 2);
});

test("jobs run in the order they were queued", async () => {
  const order: number[] = [];
  const queue = new KeyedQueue<number>(async (job) => {
    order.push(job);
  }, 1);
  [3, 1, 2].forEach((job) => queue.enqueue(String(job), job));
  await queue.onIdle();
  assert.deepEqual(order, [3, 1, 2]);
});

test("a failing job does not stop the queue", async () => {
  const done: string[] = [];
  const queue = new KeyedQueue<string>(async (job) => {
    if (job === "bad") {
      throw new Error("boom");
    }
    done.push(job);
  }, 1);
  queue.enqueue("bad", "bad");
  queue.enqueue("good", "good");
  await queue.onIdle();
  assert.deepEqual(done, ["good"]);
});
