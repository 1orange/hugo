import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSee,
  companiesForAccessRefresh,
  groupGrantsOf,
  principalsFromPermissions,
  visibleToAllowlist,
  type AccessPrincipal,
  type AccessRefreshCandidate,
} from "../../../src/modules/company-access.ts";

const user = (email: string, inherited = false): AccessPrincipal => ({
  type: "user",
  email,
  domain: null,
  role: "reader",
  inherited,
});
const domain = (name: string): AccessPrincipal => ({ type: "domain", email: null, domain: name, role: "reader", inherited: false });
const anyone: AccessPrincipal = { type: "anyone", email: null, domain: null, role: "reader", inherited: false };
const group = (email: string): AccessPrincipal => ({ type: "group", email, domain: null, role: "writer", inherited: false });

test("a direct user grant lets that email see the company, whatever its letter case", () => {
  const principals = [user("eva@kancelaria.sk")];
  assert.equal(canSee("eva@kancelaria.sk", principals), true);
  assert.equal(canSee("Eva@Kancelaria.SK", principals), true);
  assert.equal(canSee("  eva@kancelaria.sk ", principals), true);
  assert.equal(canSee("katarina@kancelaria.sk", principals), false);
});

test("an inherited user grant counts the same as a direct one", () => {
  const principals = principalsFromPermissions([
    { type: "user", role: "writer", emailAddress: "Jana@Kancelaria.sk", inherited: true },
  ]);
  assert.equal(principals[0]!.inherited, true);
  assert.equal(canSee("jana@kancelaria.sk", principals), true);
});

test("a domain grant lets every address of that domain see the company, and no other", () => {
  const principals = [domain("kancelaria.sk")];
  assert.equal(canSee("anna@kancelaria.sk", principals), true);
  assert.equal(canSee("ANNA@KANCELARIA.SK", principals), true);
  assert.equal(canSee("anna@kancelaria.sk.example.com", principals), false);
  assert.equal(canSee("anna@mail.kancelaria.sk", principals), false, "a subdomain is another domain");
});

test("an anyone grant lets every signed-in address see the company", () => {
  assert.equal(canSee("nikto@example.com", [anyone]), true);
});

test("a group grant is not expanded: it does not make anyone see the company, and it is reported", () => {
  const principals = [group("ucto@kancelaria.sk")];
  assert.equal(canSee("ucto@kancelaria.sk", principals), false);
  assert.equal(canSee("member@kancelaria.sk", principals), false);
  assert.deepEqual(groupGrantsOf(principals), principals);
});

test("no snapshot means not visible, and an empty snapshot is not visible either", () => {
  assert.equal(canSee("eva@kancelaria.sk", null), false, "never read: closed, not open");
  assert.equal(canSee("eva@kancelaria.sk", []), false);
  assert.equal(canSee("eva@kancelaria.sk", [user("")]), false, "a grant with no email matches nothing");
  assert.deepEqual(groupGrantsOf(null), []);
});

test("the allowlist is filtered to the emails the rule lets see the company", () => {
  const principals = [user("eva@kancelaria.sk"), domain("firma.sk")];
  assert.deepEqual(
    visibleToAllowlist(["eva@kancelaria.sk", "jana@firma.sk", "nik@other.sk"], principals),
    ["eva@kancelaria.sk", "jana@firma.sk"],
  );
});

test("Drive's grants become principals: emails and domains lower-cased, unknown kinds left out", () => {
  const principals = principalsFromPermissions([
    { type: "user", role: "writer", emailAddress: " Eva@Kancelaria.SK ", inherited: false },
    { type: "domain", role: "reader", domain: "Kancelaria.SK", inherited: true },
    { type: "anyone", role: "reader", inherited: false },
    { type: "group", role: "reader", emailAddress: "Ucto@Kancelaria.sk", inherited: false },
    { type: "user", role: "reader", emailAddress: null, inherited: false },
    { type: "domain", role: "reader", domain: "", inherited: false },
    { type: "pendingOwner", role: "owner", emailAddress: "x@y.sk", inherited: false },
  ]);
  assert.deepEqual(principals, [
    { type: "user", email: "eva@kancelaria.sk", domain: null, role: "writer", inherited: false },
    { type: "domain", email: null, domain: "kancelaria.sk", role: "reader", inherited: true },
    { type: "anyone", email: null, domain: null, role: "reader", inherited: false },
    { type: "group", email: "ucto@kancelaria.sk", domain: null, role: "reader", inherited: false },
  ]);
});

const parent = "clients-root";
const candidates: AccessRefreshCandidate[] = [
  { companyId: 1, driveFolderId: "firma-a", parentId: "eva-group" },
  { companyId: 2, driveFolderId: "firma-b", parentId: "eva-group" },
  { companyId: 3, driveFolderId: "firma-c", parentId: "jana-group" },
  { companyId: 4, driveFolderId: "firma-d", parentId: parent },
];
const ids = (rows: AccessRefreshCandidate[]) => rows.map((row) => row.companyId);

test("a poll or a full pass reads every company's sharing", () => {
  assert.deepEqual(
    ids(companiesForAccessRefresh({ companies: candidates, driveParentFolderId: parent, changedFileIds: [], all: true })),
    [1, 2, 3, 4],
  );
});

test("a quiet change log reads no company's sharing", () => {
  assert.deepEqual(
    ids(companiesForAccessRefresh({ companies: candidates, driveParentFolderId: parent, changedFileIds: [], all: false })),
    [],
  );
});

test("a change to a company folder reads that company; a change to a group folder reads its companies", () => {
  assert.deepEqual(
    ids(companiesForAccessRefresh({ companies: candidates, driveParentFolderId: parent, changedFileIds: ["firma-c"], all: false })),
    [3],
  );
  assert.deepEqual(
    ids(companiesForAccessRefresh({ companies: candidates, driveParentFolderId: parent, changedFileIds: ["eva-group", "unrelated-file"], all: false })),
    [1, 2],
  );
});

test("a change to the Clients folder itself reads every company, since they inherit from it", () => {
  assert.deepEqual(
    ids(companiesForAccessRefresh({ companies: candidates, driveParentFolderId: parent, changedFileIds: [parent], all: false })),
    [1, 2, 3, 4],
  );
});
