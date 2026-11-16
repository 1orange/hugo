import { test } from "node:test";
import assert from "node:assert/strict";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { insertSubject } from "../../../src/adapters/store/subjects.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies } from "../../../src/lib/db/schema.ts";
import { listSubjectDirectory, loadSubjectDetail } from "../../../src/lib/subject-directory/screen.ts";
import { freshTestDb } from "../support/test-db.ts";

const START = "2026-11-16T09:00:00.000Z";

// The Adresár lists every subject; a client's profile is one of them, marked with its company.
test("the client filter lists only the subjects that are a client's profile, each marked with its company", async () => {
  await freshTestDb();
  await getDb().insert(companies).values([
    { id: 1, driveFolderId: "alfa-folder", name: "Doklady Alfa s.r.o.", active: true },
    { id: 2, driveFolderId: "beta-folder", name: "Doklady Beta s.r.o.", active: true },
  ]);
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: "Alfa s.r.o.",
    address: "Pod Hradom 1, Bratislava",
    ico: "31333532",
    dic: "2020311335",
    icDph: "",
    registerSource: "manual",
    savedAt: START,
  });
  // A counterparty of the office's clients, and no client itself.
  await insertSubject({ country: "SK", ico: "44444444", vatId: null, legalName: "Kappa s.r.o.", now: START });

  const everyone = await listSubjectDirectory("", 100);
  assert.equal(everyone.clientsOnly, false);
  assert.equal(everyone.total, 2);
  const clientRow = everyone.rows.find((row) => row.name === "Alfa s.r.o.");
  assert.deepEqual(clientRow?.client, { href: "/companies/1/activity" });
  assert.equal(everyone.rows.find((row) => row.name === "Kappa s.r.o.")?.client, null);

  const clients = await listSubjectDirectory("", 100, { clientsOnly: true });
  assert.equal(clients.clientsOnly, true);
  assert.deepEqual(clients.rows.map((row) => row.name), ["Alfa s.r.o."]);
  assert.equal(clients.total, 1);

  // The search runs within the clients.
  const searched = await listSubjectDirectory("kappa", 100, { clientsOnly: true });
  assert.equal(searched.total, 0);
});

test("the subject of a client is the profile: its detail shows the company it is", async () => {
  await freshTestDb();
  await getDb().insert(companies).values({ id: 1, driveFolderId: "alfa-folder", name: "Doklady Alfa s.r.o.", active: true });
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: "Alfa s.r.o.",
    address: "Pod Hradom 1, Bratislava",
    ico: "31333532",
    dic: "2020311335",
    icDph: "",
    registerSource: "manual",
    savedAt: START,
  });
  const [row] = (await listSubjectDirectory("", 100, { clientsOnly: true })).rows;
  const detail = await loadSubjectDetail(row!.id);
  assert.equal(detail?.linkedCompany?.id, 1);
  assert.equal(detail?.legalName, "Alfa s.r.o.");
});
