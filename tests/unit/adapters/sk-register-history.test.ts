import { test } from "node:test";
import assert from "node:assert/strict";
import { SkCompanyRegister } from "../../../src/adapters/company-register/sk-company-register.ts";
import { searchRpoByName, searchRpoHistoryByName } from "../../../src/adapters/company-register/rpo-client.ts";

// RPO keeps every attribute as a history; the current entry has no validTo.
const RPO_ENTITY = {
  identifiers: [{ value: "31322832", validFrom: "2001-01-01" }],
  fullNames: [
    { value: "Alfa Group, a.s.", validFrom: "2015-01-01", validTo: null },
    { value: "Alfa Trade, s.r.o.", validFrom: "2001-01-01", validTo: "2015-01-01" },
  ],
  addresses: [],
  termination: null,
};

const RUZ_UNIT = {
  id: 7,
  ico: "31322832",
  dic: "2020322832",
  nazovUJ: "Alfa Group, a.s.",
  ulica: "Pribinova 25",
  psc: "81109",
  mesto: "Bratislava",
  datumPoslednejUpravy: "2015-02-01",
};

/** A fetch that answers the two registers' URLs from fixtures and records what it was asked. */
function registers(asked: string[]): typeof fetch {
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  return (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (url.includes("api.statistics.sk/rpo/v1/search")) {
      return respond({ results: [RPO_ENTITY] });
    }
    if (url.includes("uctovne-jednotky")) {
      return respond({ id: [7] });
    }
    if (url.includes("uctovna-jednotka?id=7")) {
      return respond(RUZ_UNIT);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("RPO's history gives the former names of an entity, and the plain search does not", async () => {
  const asked: string[] = [];
  const history = await searchRpoHistoryByName("Alfa Group", registers(asked));

  assert.deepEqual(history, [
    {
      ico: "31322832",
      legalName: "Alfa Group, a.s.",
      address: "",
      status: "active",
      formerNames: ["Alfa Trade, s.r.o."],
    },
  ]);
  assert.deepEqual(await searchRpoByName("Alfa Group", registers([])), [
    { ico: "31322832", legalName: "Alfa Group, a.s.", address: "", status: "active" },
  ]);
});

test("a lookup with history adds the former names and status from RPO; without it, RÚZ alone is asked", async () => {
  const plainAsked: string[] = [];
  const plainLookup = await new SkCompanyRegister(registers(plainAsked)).lookupByIco("31322832", "SK");
  assert.ok(plainLookup);
  assert.equal(plainLookup.legalName, "Alfa Group, a.s.");
  assert.equal("formerNames" in plainLookup, false);
  assert.ok(plainAsked.every((url) => !url.includes("rpo")), "setup asks RÚZ only");

  const asked: string[] = [];
  const lookup = await new SkCompanyRegister(registers(asked)).lookupByIco("31322832", "SK", { withHistory: true });
  assert.deepEqual(lookup, {
    country: "SK",
    ico: "31322832",
    legalName: "Alfa Group, a.s.",
    address: "Pribinova 25, 811 09 Bratislava",
    dic: "2020322832",
    formerNames: ["Alfa Trade, s.r.o."],
    status: "active",
  });
  assert.ok(asked.some((url) => url.includes("rpo/v1/search")));
});

test("a failing history leaves the RÚZ lookup as it was, with the names unknown rather than none", async () => {
  const failing = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("rpo/v1/search")) {
      return new Response("unavailable", { status: 503 });
    }
    if (url.includes("uctovne-jednotky")) {
      return new Response(JSON.stringify({ id: [7] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(RUZ_UNIT), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const lookup = await new SkCompanyRegister(failing).lookupByIco("31322832", "SK", { withHistory: true });

  assert.equal(lookup?.legalName, "Alfa Group, a.s.");
  assert.equal("formerNames" in (lookup ?? {}), false);
});
