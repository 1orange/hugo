import { test } from "node:test";
import assert from "node:assert/strict";
import { extractionFailureMessage } from "../../../src/modules/extraction-failure.ts";

test("the pipeline's reasons are shown in Slovak", () => {
  assert.equal(
    extractionFailureMessage("Reading the document failed: Invalid PDF structure."),
    "Súbor PDF je poškodený, nedá sa otvoriť.",
  );
  assert.equal(
    extractionFailureMessage("Reading the document failed: input buffer is not a HEIC image"),
    "Fotografiu vo formáte HEIC sa nepodarilo otvoriť.",
  );
  assert.match(extractionFailureMessage("no eKasa code found"), /kód eKasa/);
});

test("an unknown crash keeps its detail; a reason already in Slovak is left alone", () => {
  assert.equal(
    extractionFailureMessage("Reading the document failed: socket hang up"),
    "Doklad sa nepodarilo prečítať (socket hang up).",
  );
  assert.equal(extractionFailureMessage("Chýba dátum dokladu."), "Chýba dátum dokladu.");
});
