import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseDraft } from "../../../src/modules/draft-rebase.ts";

const saved = { supplierName: "", ico: "", amountLiteral: "", vatRecap: [] as string[] };

test("a field she is typing survives a refresh of the same document", () => {
  const draft = { ...saved, ico: "3133" };
  const incoming = { ...saved, supplierName: "Dodávateľ s.r.o.", amountLiteral: "123.00" };

  const merged = rebaseDraft({ saved, draft, incoming });

  assert.equal(merged.ico, "3133");
  // Fields she did not touch take what the background extraction just read.
  assert.equal(merged.supplierName, "Dodávateľ s.r.o.");
  assert.equal(merged.amountLiteral, "123.00");
});

test("with nothing edited, the refresh replaces the draft entirely", () => {
  const incoming = { ...saved, supplierName: "Test Shop", vatRecap: ["23"] };
  assert.deepEqual(rebaseDraft({ saved, draft: { ...saved }, incoming }), incoming);
});

test("her edit wins even when the refresh brings a different value for that field", () => {
  const draft = { ...saved, supplierName: "Moje s.r.o." };
  const incoming = { ...saved, supplierName: "Dodávateľ s.r.o." };
  assert.equal(rebaseDraft({ saved, draft, incoming }).supplierName, "Moje s.r.o.");
});

test("list fields are compared whole", () => {
  const draft = { ...saved, vatRecap: ["23", "5"] };
  const incoming = { ...saved, vatRecap: ["19"] };
  assert.deepEqual(rebaseDraft({ saved, draft, incoming }).vatRecap, ["23", "5"]);
});

test("a saved edit coming back from the server is no longer pending", () => {
  const draft = { ...saved, ico: "31333532" };
  const incoming = { ...saved, ico: "31333532" };
  const merged = rebaseDraft({ saved, draft, incoming });
  assert.deepEqual(merged, incoming);
});
