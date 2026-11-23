import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDriveClientWithChanges } from "../../../src/adapters/drive/fake-drive-client.ts";
import type { DriveClient } from "../../../src/adapters/drive/port.ts";
import { getCompanyByDriveFolderId } from "../../../src/adapters/store/companies.ts";
import { listCompaniesAccess, listCompanyPrincipals } from "../../../src/adapters/store/company-access.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { canSee, type DrivePermission } from "../../../src/modules/company-access.ts";
import { FOLDER_MIME, type DriveFileRecord } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

const PARENT_ID = "access-parent";
const EVA_GROUP = "access-group-eva";
const JANA_GROUP = "access-group-jana";
const ALFA = "access-company-alfa";
const BETA = "access-company-beta";
const GAMA = "access-company-gama";

function folder(id: string, name: string, parent: string | null): DriveFileRecord {
  return { id, name, parents: parent ? [parent] : [], createdTime: "2026-10-01T00:00:00.000Z", mimeType: FOLDER_MIME };
}

function drive(): FakeDriveClientWithChanges {
  return new FakeDriveClientWithChanges([
    folder(PARENT_ID, "Doklady klientov", null),
    folder(EVA_GROUP, "Eva", PARENT_ID),
    folder(JANA_GROUP, "Jana", PARENT_ID),
    folder(ALFA, "Doklady Alfa", EVA_GROUP),
    folder(BETA, "Doklady Beta", EVA_GROUP),
    folder(GAMA, "Doklady Gama", JANA_GROUP),
  ]);
}

const userGrant = (email: string, inherited = false): DrivePermission => ({ type: "user", role: "writer", emailAddress: email, inherited });

async function companyIdOf(driveFolderId: string): Promise<number> {
  const company = await getCompanyByDriveFolderId(driveFolderId);
  assert.ok(company, `company ${driveFolderId} is in the database`);
  return company.id;
}

test("a poll reads every company's sharing and stores it, lower-cased, with the inherited flag", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();
  client.setPermissions(ALFA, [userGrant("Eva@Kancelaria.sk")]);
  client.setPermissions(BETA, [{ type: "domain", role: "reader", domain: "Kancelaria.sk", inherited: true }]);
  client.setPermissions(GAMA, [{ type: "group", role: "reader", emailAddress: "ucto@kancelaria.sk", inherited: false }]);

  await runSweep(client, { allAccess: true });

  assert.deepEqual([...client.permissionCalls].sort(), [ALFA, BETA, GAMA].sort());
  const alfa = await listCompanyPrincipals(await companyIdOf(ALFA));
  assert.deepEqual(alfa, [{ type: "user", email: "eva@kancelaria.sk", domain: null, role: "writer", inherited: false }]);
  assert.equal(canSee("eva@kancelaria.sk", alfa), true);

  const beta = await listCompanyPrincipals(await companyIdOf(BETA));
  assert.equal(canSee("anna@kancelaria.sk", beta), true, "a domain grant reaches the whole domain");
  assert.equal(beta[0]!.inherited, true);

  const access = await listCompaniesAccess();
  assert.equal(access.length, 3);
  assert.ok(access.every((company) => company.refreshedAt !== null && company.error === null));
});

test("a sweep that reads only the change log reads only the companies the log names", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();
  await runSweep(client); // the first sweep lists everything, so every company is read
  client.permissionCalls.length = 0;

  await client.rename(ALFA, "Doklady Alfa");
  await runSweep(client);
  assert.deepEqual(client.permissionCalls, [ALFA], "a company folder's change reads that company");

  client.permissionCalls.length = 0;
  await client.rename(EVA_GROUP, "Eva");
  await runSweep(client);
  assert.deepEqual([...client.permissionCalls].sort(), [ALFA, BETA].sort(), "a group folder's change reads its companies");

  client.permissionCalls.length = 0;
  await runSweep(client);
  assert.deepEqual(client.permissionCalls, [], "a quiet sweep reads no sharing");
});

test("a failed read keeps the company's previous snapshot and records the error; the others are still read", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();
  client.setPermissions(ALFA, [userGrant("eva@kancelaria.sk")]);
  client.setPermissions(BETA, [userGrant("jana@kancelaria.sk")]);
  await runSweep(client, { allAccess: true });
  const alfaBefore = (await listCompaniesAccess()).find((company) => company.name === "Doklady Alfa")!;

  client.setPermissions(ALFA, [userGrant("nova@kancelaria.sk")]);
  client.setPermissions(BETA, [userGrant("nova@kancelaria.sk")]);
  client.failingPermissionFolders.add(ALFA);
  await runSweep(client, { allAccess: true });

  const alfaAfter = (await listCompaniesAccess()).find((company) => company.name === "Doklady Alfa")!;
  assert.deepEqual(alfaAfter.principals, alfaBefore.principals, "the snapshot before the failure is kept");
  assert.equal(alfaAfter.refreshedAt, alfaBefore.refreshedAt, "the time of the last success is kept");
  assert.match(alfaAfter.error ?? "", /status 403/);
  assert.equal(canSee("eva@kancelaria.sk", alfaAfter.principals), true, "still the old rule, not the new one");

  const beta = (await listCompaniesAccess()).find((company) => company.name === "Doklady Beta")!;
  assert.equal(beta.error, null);
  assert.equal(canSee("nova@kancelaria.sk", beta.principals), true);

  client.failingPermissionFolders.clear();
  await runSweep(client, { allAccess: true });
  const recovered = (await listCompaniesAccess()).find((company) => company.name === "Doklady Alfa")!;
  assert.equal(recovered.error, null, "a successful read clears the error");
  assert.equal(canSee("nova@kancelaria.sk", recovered.principals), true);
});

test("a client without the sharing capability still sweeps; no company gets a snapshot", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const fake = drive();
  // Only the four calls every Drive client has: no permissions, no change log.
  const bare: DriveClient = {
    list: () => fake.list(),
    download: (fileId) => fake.download(fileId),
    rename: (fileId, name) => fake.rename(fileId, name),
    move: (fileId, from, to) => fake.move(fileId, from, to),
  };

  const result = await runSweep(bare, { allAccess: true });

  assert.equal(result.companyCount, 3);
  assert.deepEqual(fake.permissionCalls, []);
  const access = await listCompaniesAccess();
  assert.equal(access.length, 3);
  assert.ok(access.every((company) => company.refreshedAt === null && company.principals.length === 0));
});
