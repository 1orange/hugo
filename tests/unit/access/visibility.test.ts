import { test } from "node:test";
import assert from "node:assert/strict";
import { visibilityOf, restrictQueueToCompanies, restrictEventToCompanies } from "../../../src/lib/access/visibility.ts";
import type { CompanyAccessRow } from "../../../src/adapters/store/company-access.ts";
import type { AppEvent } from "../../../src/lib/events/bus.ts";

const SNAPSHOT = "2026-11-20T08:00:00.000Z";

/** One company's rows: a row per principal, or one with a null principal when it has none. */
function rowsOf(companyId: number, refreshedAt: string | null, principals: Array<CompanyAccessRow["principal"]>): CompanyAccessRow[] {
  if (principals.length === 0) {
    return [{ companyId, accessRefreshedAt: refreshedAt, principal: null }];
  }
  return principals.map((principal) => ({ companyId, accessRefreshedAt: refreshedAt, principal }));
}

const userOf = (email: string) => ({ type: "user" as const, email, domain: null, role: "writer", inherited: false });
const domainOf = (domain: string) => ({ type: "domain" as const, email: null, domain, role: "reader", inherited: true });

test("a person sees the companies shared with their email, and only those", () => {
  const rows = [
    ...rowsOf(1, SNAPSHOT, [userOf("eva@kancelaria.sk")]),
    ...rowsOf(2, SNAPSHOT, [userOf("jana@kancelaria.sk")]),
    ...rowsOf(3, SNAPSHOT, [domainOf("kancelaria.sk")]),
  ];

  const eva = visibilityOf("Eva@Kancelaria.sk", rows);
  assert.deepEqual([...eva.ids].sort(), [1, 3], "a direct grant and a domain grant both count");
  assert.equal(eva.activeCount, 3);
  assert.equal(eva.snapshotted, true);

  const stranger = visibilityOf("stranger@example.com", rows);
  assert.deepEqual([...stranger.ids], [], "a stranger sees none");
});

test("a company whose sharing was never read is invisible to everyone, even with principals", () => {
  const rows = [...rowsOf(1, null, [userOf("eva@kancelaria.sk")]), ...rowsOf(2, SNAPSHOT, [userOf("eva@kancelaria.sk")])];

  const eva = visibilityOf("eva@kancelaria.sk", rows);
  assert.deepEqual([...eva.ids], [2], "fail closed: no snapshot, no visibility");
});

test("a group grant alone shows nothing: groups are not expanded", () => {
  const group = { type: "group" as const, email: "ucto@kancelaria.sk", domain: null, role: "reader", inherited: false };
  const rows = rowsOf(4, SNAPSHOT, [group]);

  assert.deepEqual([...visibilityOf("ucto@kancelaria.sk", rows).ids], []);
});

test("before any read, no company is visible and the screens are told Hugo is still waiting", () => {
  const rows = [...rowsOf(1, null, []), ...rowsOf(2, null, [])];

  const view = visibilityOf("eva@kancelaria.sk", rows);
  assert.deepEqual([...view.ids], []);
  assert.equal(view.activeCount, 2, "there are companies, so this is not the empty database");
  assert.equal(view.snapshotted, false, "no snapshot anywhere: the loading message, not no-access");
});

test("with snapshots but none visible, the screens can say there is no access", () => {
  const rows = rowsOf(1, SNAPSHOT, [userOf("someone@else.sk")]);

  const view = visibilityOf("eva@kancelaria.sk", rows);
  assert.deepEqual([...view.ids], []);
  assert.equal(view.snapshotted, true);
});

test("a database with no companies has activeCount zero", () => {
  assert.equal(visibilityOf("eva@kancelaria.sk", []).activeCount, 0);
});

test("the queue keeps only the jobs and finished records of visible companies, and leaves the counts alone", () => {
  const job = (companyId: number) => ({ companyId, driveFileId: `f${companyId}` });
  const view = {
    concurrency: { read: 2, model: 1 },
    running: [job(1), job(2)],
    waiting: [job(2)],
    delayed: [job(3)],
    recent: [job(1), job(2), job(3)],
  };

  const kept = restrictQueueToCompanies(view, new Set([1]));

  assert.deepEqual(kept.running.map((entry) => entry.companyId), [1]);
  assert.deepEqual(kept.waiting, []);
  assert.deepEqual(kept.delayed, []);
  assert.deepEqual(kept.recent.map((entry) => entry.companyId), [1]);
  assert.deepEqual(kept.concurrency, { read: 2, model: 1 });
});

test("a live event reaches a person only for their companies", () => {
  const ids = new Set([1]);
  const read = { type: "document-read", companyId: 2, monthKey: "2026_01", driveFileId: "x", outcome: "complete" } as const;
  const own = { type: "document-read", companyId: 1, monthKey: "2026_01", driveFileId: "y", outcome: "failed" } as const;

  assert.equal(restrictEventToCompanies(read, ids), null);
  assert.deepEqual(restrictEventToCompanies(own, ids), own);
});

test("a sweep's change log names several companies; only the visible months are kept", () => {
  const event: AppEvent = {
    type: "files-changed",
    months: [
      { companyId: 1, monthKey: "2026_01" },
      { companyId: 2, monthKey: "2026_01" },
      { companyId: 2, monthKey: "2025_12" },
    ],
  };

  assert.deepEqual(restrictEventToCompanies(event, new Set([2])), {
    type: "files-changed",
    months: [
      { companyId: 2, monthKey: "2026_01" },
      { companyId: 2, monthKey: "2025_12" },
    ],
  });
  assert.equal(restrictEventToCompanies(event, new Set([9])), null);
});

test("queue-changed and services-changed carry no company and always pass", () => {
  assert.deepEqual(restrictEventToCompanies({ type: "queue-changed" }, new Set()), { type: "queue-changed" });
  assert.deepEqual(restrictEventToCompanies({ type: "services-changed" }, new Set()), { type: "services-changed" });
});
