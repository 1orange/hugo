import { test } from "node:test";
import assert from "node:assert/strict";
import { fillCounterpartyIcDph } from "../../../src/modules/printed-vat-numbers.ts";

const client = { country: "SK" as const, ico: "36123456", dic: "2020123456", icDph: "SK2020123456", legalName: "Modrá hora s. r. o." };
const her = { name: "Modrá hora s.r.o.", ico: null, dic: null, icDph: null };
const seller = { name: "MODIVO.com S.A.", ico: null, dic: null, icDph: null };

// MODIVO prints its VAT number as "DIČ: SK4120004493"; the model missed it.
test("the one VAT number that is no one's is the counterparty's", () => {
  const lines = ["MODIVO.com S.A.", "DIČ: SK4120004493", "BDO 000012345", "Odberateľ", "Modrá hora s.r.o.", "DIČ 2020123456"];
  assert.deepEqual(fillCounterpartyIcDph([seller, her], lines, client), [{ ...seller, icDph: "SK4120004493" }, her]);
});

test("nothing is filled when it is not clear whose number it is", () => {
  const two = ["Predajca DIČ: SK4120004493", "Sklad DIČ: SK2020000000", "Odberateľ Modrá hora s.r.o."];
  assert.deepEqual(fillCounterpartyIcDph([seller, her], two, client), [seller, her]);
  // Only hers is printed.
  assert.deepEqual(fillCounterpartyIcDph([seller, her], ["IČ DPH: SK2020123456"], client), [seller, her]);
  // Her company is not among the parties.
  const other = { name: "Iný s.r.o.", ico: "11111111", dic: null, icDph: null };
  assert.deepEqual(fillCounterpartyIcDph([seller, other], ["SK4120004493"], client), [seller, other]);
  // The model found it itself.
  const found = { ...seller, icDph: "SK4120004493" };
  assert.deepEqual(fillCounterpartyIcDph([found, her], ["SK4120004493", "SK2020000000"], client), [found, her]);
});

test("a word that starts like a country is no VAT number", () => {
  assert.deepEqual(fillCounterpartyIcDph([seller, her], ["PLATBA NOWY", "Zoznam platieb: ECOM"], client), [seller, her]);
});
