import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCompanyStage,
  nextMonthKey,
  planMonthScaffolding,
} from "../../../src/modules/month-lifecycle.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

test("nextMonthKey advances within and across years", () => {
  assert.equal(nextMonthKey("2026_03"), "2026_04");
  assert.equal(nextMonthKey("2026_12"), "2027_01");
});

test("nextMonthKey rejects malformed keys", () => {
  assert.equal(nextMonthKey("2026-03"), null);
  assert.equal(nextMonthKey("not-a-month"), null);
});

test("planMonthScaffolding skips existing canonical folders", () => {
  const plan = planMonthScaffolding(
    [
      { name: "01 Vystavené faktúry", classification: { kind: "canonical", name: "01 Vystavené faktúry" } },
      { name: "02 Prijaté faktúry", classification: { kind: "canonical", name: "02 Prijaté faktúry" } },
    ],
    CANONICAL_FOLDER_NAMES,
  );
  assert.deepEqual(plan, [
    "03 Bankové výpisy",
    "04 Bločky_hotovosť",
    "05 Bločky_firemná karta",
    "06 Iné doklady",
    "07 Mzdy",
  ]);
});

test("planMonthScaffolding does not duplicate repair-candidate slots", () => {
  const plan = planMonthScaffolding(
    [
      {
        name: "04 Bločky_hotorvosť",
        classification: {
          kind: "repair-candidate",
          observedName: "04 Bločky_hotorvosť",
          targetName: "04 Bločky_hotovosť",
        },
      },
    ],
    CANONICAL_FOLDER_NAMES,
  );
  assert.ok(!plan.includes("04 Bločky_hotovosť"));
  assert.equal(plan.length, CANONICAL_FOLDER_NAMES.length - 1);
});

test("planMonthScaffolding does not duplicate unknown folders in the same slot", () => {
  const plan = planMonthScaffolding(
    [{ name: "04 Pokladňa", classification: { kind: "unknown", name: "04 Pokladňa" } }],
    CANONICAL_FOLDER_NAMES,
  );
  assert.ok(!plan.includes("04 Bločky_hotovosť"));
});

test("deriveCompanyStage reports collect with unknown unticked count", () => {
  const stage = deriveCompanyStage({ openMonthKey: "2026_02", untickedCount: null });
  assert.equal(stage.stage, "collect");
  assert.equal(stage.untickedCount, null);
});

test("deriveCompanyStage degrades when no open month", () => {
  const stage = deriveCompanyStage({ openMonthKey: null, untickedCount: null });
  assert.equal(stage.stage, "idle");
});
