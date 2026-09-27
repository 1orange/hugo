import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";

test("fake register search returns Beta candidates without calling HTTP", async () => {
  const register = new FakeCompanyRegister();
  const hits = await register.searchByName("Beta s.r.o.", "SK");
  assert.ok(hits.length >= 2);
  assert.ok(hits.some((hit) => hit.ico === "31333532"));
});

test("fake register lookup fills DIČ from RÚZ fixture", async () => {
  const register = new FakeCompanyRegister();
  const lookup = await register.lookupByIco("31333532", "SK");
  assert.ok(lookup);
  assert.equal(lookup.dic, "2020311335");
  assert.equal(lookup.country, "SK");
});

test("fake register search returns Gamma candidates for CZ", async () => {
  const register = new FakeCompanyRegister();
  const hits = await register.searchByName("Gamma s.r.o.", "CZ");
  assert.ok(hits.some((hit) => hit.ico === "87654321"));
});

test("fake register CZ lookup returns CZ DIČ", async () => {
  const register = new FakeCompanyRegister();
  const lookup = await register.lookupByIco("87654321", "CZ");
  assert.ok(lookup);
  assert.equal(lookup.country, "CZ");
  assert.equal(lookup.dic, "CZ87654321");
  assert.equal(await register.lookupByIco("87654321", "SK"), null);
});
