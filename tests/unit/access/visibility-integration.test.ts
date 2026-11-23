import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies } from "../../../src/lib/db/schema.ts";
import { upsertCompany } from "../../../src/adapters/store/companies.ts";
import { replaceCompanyPrincipals } from "../../../src/adapters/store/company-access.ts";
import { isCompanyVisible, visibleCompanies } from "../../../src/lib/access/visibility.ts";
import { COMPANY_NOT_VISIBLE_MESSAGE, companyRefusalFor } from "../../../src/lib/access/guard.ts";
import type { AccessPrincipal } from "../../../src/modules/company-access.ts";
import { freshTestDb } from "../support/test-db.ts";

const SNAPSHOT = "2026-11-20T08:00:00.000Z";
const EVA = "eva@kancelaria.sk";
const JANA = "jana@kancelaria.sk";

const user = (email: string): AccessPrincipal => ({ type: "user", email, domain: null, role: "writer", inherited: false });

/**
 * Alfa is shared with Eva directly, Beta with the whole kancelaria.sk domain,
 * Gama only with a group, Delta has never been read. Epsilon is inactive.
 */
async function seedCompanies(): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const name of ["Alfa", "Beta", "Gama", "Delta", "Epsilon"]) {
    ids[name] = (await upsertCompany(`drive-${name.toLowerCase()}`, `Doklady ${name}`)).id;
  }
  await replaceCompanyPrincipals(ids.Alfa!, [user(EVA)], SNAPSHOT);
  await replaceCompanyPrincipals(
    ids.Beta!,
    [{ type: "domain", email: null, domain: "kancelaria.sk", role: "reader", inherited: true }],
    SNAPSHOT,
  );
  await replaceCompanyPrincipals(
    ids.Gama!,
    [{ type: "group", email: "ucto@kancelaria.sk", domain: null, role: "reader", inherited: false }],
    SNAPSHOT,
  );
  await replaceCompanyPrincipals(ids.Epsilon!, [user(EVA)], SNAPSHOT);
  await getDb().update(companies).set({ active: false }).where(eq(companies.id, ids.Epsilon!));
  return ids;
}

test("each person's visible companies follow their Drive sharing, in one query", async () => {
  await freshTestDb();
  const ids = await seedCompanies();

  const eva = await visibleCompanies(EVA);
  assert.deepEqual([...eva.ids].sort((a, b) => a - b), [ids.Alfa!, ids.Beta!].sort((a, b) => a - b));
  assert.equal(eva.activeCount, 4, "the inactive company is not counted");
  assert.equal(eva.snapshotted, true);

  const jana = await visibleCompanies(JANA);
  assert.deepEqual([...jana.ids], [ids.Beta], "the domain grant reaches Jana too");
});

test("the guard answers per company, and an inactive or never-read company is not visible", async () => {
  await freshTestDb();
  const ids = await seedCompanies();

  assert.equal(await isCompanyVisible(EVA, ids.Alfa!), true);
  assert.equal(await isCompanyVisible(JANA, ids.Alfa!), false, "another person's company is not found for her");
  assert.equal(await isCompanyVisible(EVA, ids.Gama!), false, "a group grant does not admit anyone");
  assert.equal(await isCompanyVisible(EVA, ids.Delta!), false, "never read: closed");
  assert.equal(await isCompanyVisible(EVA, ids.Epsilon!), false, "inactive: closed");
});

test("an action on a company the person may not see is refused with the same message as a missing one", async () => {
  await freshTestDb();
  const ids = await seedCompanies();

  assert.equal(await companyRefusalFor(EVA, ids.Alfa!), null, "a visible company carries on");

  const refused = await companyRefusalFor(JANA, ids.Alfa!);
  assert.deepEqual(refused, { ok: false, message: COMPANY_NOT_VISIBLE_MESSAGE });

  const missing = await companyRefusalFor(EVA, 9999);
  assert.deepEqual(missing, refused, "a missing company and an invisible one look the same");

  assert.deepEqual(await companyRefusalFor(null, ids.Alfa!), refused, "no session, no company");
});

test("before the first read nothing is visible and no snapshot is reported", async () => {
  await freshTestDb();
  await upsertCompany("drive-a", "Doklady A");
  await upsertCompany("drive-b", "Doklady B");

  const view = await visibleCompanies(EVA);
  assert.deepEqual([...view.ids], []);
  assert.equal(view.activeCount, 2);
  assert.equal(view.snapshotted, false);
});

test("an empty database reports no companies at all", async () => {
  await freshTestDb();

  const view = await visibleCompanies(EVA);
  assert.deepEqual([...view.ids], []);
  assert.equal(view.activeCount, 0);
});
