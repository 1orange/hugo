import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupSourceOf, profileProvenance, type ProfileValues } from "../../../src/modules/company-profile.ts";

const FILLED: ProfileValues = {
  legalName: "Alfa s.r.o.",
  address: "Pod Hradom 1, Bratislava",
  dic: "2020311335",
  icDph: "SK2020311335",
};

test("a lookup's values are the register's, and an IČ DPH VIES confirmed is VIES's", () => {
  assert.equal(lookupSourceOf("rpo+ruz", "legalName"), "register");
  assert.equal(lookupSourceOf("ares", "address"), "register");
  assert.equal(lookupSourceOf("rpo+ruz+vies", "icDph"), "vies");
  assert.equal(lookupSourceOf("rpo+ruz", "icDph"), null, "an IČ DPH the lookup did not confirm is hers to type");
  assert.equal(lookupSourceOf("manual", "legalName"), null);
  assert.equal(lookupSourceOf("client-sheet", "dic"), null);
});

test("a fresh save from a lookup gives each filled field its register source, and an empty field none", () => {
  const plan = profileProvenance({
    previous: null,
    next: { ...FILLED, icDph: "" },
    registerSource: "rpo+ruz",
    typed: [],
  });
  assert.deepEqual(plan.sources, { legalName: "register", address: "register", dic: "register" });
  assert.deepEqual(plan.changed, ["legalName", "address", "dic"]);
});

test("a field she typed is manual, whatever the lookup said", () => {
  const plan = profileProvenance({
    previous: null,
    next: FILLED,
    registerSource: "rpo+ruz+vies",
    typed: ["address"],
  });
  assert.equal(plan.sources.address, "manual");
  assert.equal(plan.sources.legalName, "register");
  assert.equal(plan.sources.icDph, "vies");
});

test("a value that did not change keeps the source the subject holds, even when the form says otherwise", () => {
  const plan = profileProvenance({
    previous: {
      values: FILLED,
      sources: { legalName: "register", address: "manual", dic: "register", icDph: "vies" },
    },
    next: FILLED,
    registerSource: "",
    typed: [],
  });
  assert.deepEqual(plan.sources, { legalName: "register", address: "manual", dic: "register", icDph: "vies" });
  assert.deepEqual(plan.changed, []);
});

test("a changed value with no lookup and no typing from the form is manual", () => {
  const plan = profileProvenance({
    previous: { values: FILLED, sources: { legalName: "register", address: "register", dic: "register", icDph: "vies" } },
    next: { ...FILLED, legalName: "Alfa Holding s.r.o." },
    registerSource: "",
    typed: [],
  });
  assert.equal(plan.sources.legalName, "manual");
  assert.equal(plan.sources.address, "register", "an unchanged value keeps its source");
  assert.deepEqual(plan.changed, ["legalName"]);
});

test("a value the subject held with no source is taken as changed, not kept", () => {
  const plan = profileProvenance({
    previous: { values: FILLED, sources: {} },
    next: FILLED,
    registerSource: "rpo+ruz",
    typed: [],
  });
  assert.equal(plan.sources.legalName, "register");
  assert.equal(plan.sources.icDph, "manual", "an IČ DPH the lookup did not confirm is no register's");
  assert.deepEqual(plan.changed, ["legalName", "address", "dic", "icDph"]);
});

test("an empty field has no source, so a register refresh may fill it", () => {
  const plan = profileProvenance({
    previous: null,
    next: { ...FILLED, dic: "", icDph: "" },
    registerSource: "manual",
    typed: [],
  });
  assert.equal("dic" in plan.sources, false);
  assert.equal("icDph" in plan.sources, false);
});
