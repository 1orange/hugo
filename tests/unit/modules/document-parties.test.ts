import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePartiesSharingIco } from "../../../src/modules/document-parties.ts";

// A parking ticket: the seller's brand and legal name, one IČO.
test("parties with one IČO are one company, named with its legal form", () => {
  assert.deepEqual(
    mergePartiesSharingIco([
      { name: "CENTRAL Bratislava", ico: "46872884", dic: null, icDph: "SK2023619895" },
      { name: "Central Shopping Center, a. s.", ico: "46 872 884", dic: "2023619895", icDph: "SK2023619895" },
    ]),
    [{ name: "Central Shopping Center, a. s.", ico: "46872884", dic: "2023619895", icDph: "SK2023619895" }],
  );
});

// The car's plate, made a party with the seller's numbers.
test("a party with the seller's IČO under another name is the seller", () => {
  const seller = { name: "Stanica Nivy s.r.o.", ico: "50861930", dic: null, icDph: "SK2120532249" };
  assert.deepEqual(mergePartiesSharingIco([seller, { name: "BA123XY", ico: "50861930", dic: null, icDph: "SK2120532249" }]), [
    seller,
  ]);
});

test("different companies stay apart, whatever their IČ DPH", () => {
  const parties = [
    { name: "SLOVNAFT, a.s.", ico: "31322832", dic: null, icDph: "SK7120001713" },
    { name: "MOL Slovensko spol. s r.o.", ico: "35000000", dic: null, icDph: "SK7120001713" },
    { name: "Bez IČO", ico: null, dic: null, icDph: null },
    { name: "Tiež bez IČO", ico: null, dic: null, icDph: null },
  ];
  assert.deepEqual(mergePartiesSharingIco(parties), parties);
});
