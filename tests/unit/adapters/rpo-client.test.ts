import { test } from "node:test";
import assert from "node:assert/strict";
import { searchRpoByName } from "../../../src/adapters/company-register/rpo-client.ts";

// Shapes as api.statistics.sk returned them on 2026-09-29: every attribute a
// history, the current entry without `validTo`, termination a bare date.
const SPRING_ETC = {
  id: 1050419,
  identifiers: [{ value: "45891761", validFrom: "2010-11-19" }],
  fullNames: [{ value: "SPRING.etc., spol. s r. o.", validFrom: "2010-11-19" }],
  addresses: [
    {
      validFrom: "2010-11-19",
      street: "J. Stanislava",
      regNumber: 0,
      buildingNumber: "20/B",
      postalCodes: ["84105"],
      municipality: { value: "Bratislava - Karlova Ves" },
    },
  ],
  establishment: "2010-11-19",
};

const RENAMED_AND_MOVED = {
  id: 192717,
  identifiers: [{ value: "43964095", validFrom: "2008-03-01" }],
  fullNames: [
    { value: "AB LACHO, s.r.o.", validFrom: "2008-03-01", validTo: "2024-03-27" },
    { value: "ABL s.r.o.", validFrom: "2024-03-28" },
  ],
  addresses: [
    {
      validFrom: "2014-11-21",
      street: "Tomášikova",
      regNumber: 0,
      buildingNumber: "30",
      postalCodes: ["82101"],
      municipality: { value: "Bratislava" },
    },
    {
      validFrom: "2008-03-01",
      validTo: "2014-11-20",
      street: "Rajecká",
      buildingNumber: "8682/6",
      postalCodes: ["82107"],
      municipality: { value: "Bratislava - Vrakuňa" },
    },
  ],
};

const DISSOLVED = {
  id: 197130,
  identifiers: [{ value: "46851496", validFrom: "2012-10-04" }],
  fullNames: [{ value: "Springtime 2012 s.r.o.", validFrom: "2012-10-04", validTo: "2015-01-30" }],
  addresses: [],
  termination: "2015-01-31",
};

function respondWith(byQuery: Record<string, unknown[]>, asked: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const query = new URL(String(input)).searchParams.get("fullName") ?? "";
    asked.push(query);
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: byQuery[query] ?? [], license: "CC-BY 4.0" }),
    } as Response;
  }) as typeof fetch;
}

test("searchRpoByName reads the current IČO, name and address of each entity", async () => {
  const hits = await searchRpoByName("spring", respondWith({ spring: [SPRING_ETC] }));
  assert.deepEqual(hits, [
    {
      ico: "45891761",
      legalName: "SPRING.etc., spol. s r. o.",
      address: "J. Stanislava 20/B, 841 05 Bratislava - Karlova Ves",
      status: "active",
    },
  ]);
});

test("searchRpoByName takes the name and address without an end date, not the first", async () => {
  const [hit] = await searchRpoByName("ab", respondWith({ ab: [RENAMED_AND_MOVED] }));
  assert.equal(hit!.legalName, "ABL s.r.o.");
  assert.equal(hit!.address, "Tomášikova 30, 821 01 Bratislava");
});

test("searchRpoByName marks an entity with a termination date dissolved", async () => {
  const [hit] = await searchRpoByName("spring", respondWith({ spring: [DISSOLVED] }));
  assert.equal(hit!.status, "dissolved");
  assert.equal(hit!.legalName, "Springtime 2012 s.r.o.");
});

test("searchRpoByName asks again by the longest word when the whole query finds nothing", async () => {
  const asked: string[] = [];
  const hits = await searchRpoByName("spring etc", respondWith({ spring: [SPRING_ETC, DISSOLVED] }, asked));
  assert.deepEqual(asked, ["spring etc", "spring"]);
  assert.equal(hits.length, 2);
});

test("searchRpoByName does not repeat a one-word query", async () => {
  const asked: string[] = [];
  assert.deepEqual(await searchRpoByName("nothing", respondWith({}, asked)), []);
  assert.deepEqual(asked, ["nothing"]);
});

test("searchRpoByName lists an entity once when it is returned twice", async () => {
  const hits = await searchRpoByName("spring", respondWith({ spring: [SPRING_ETC, SPRING_ETC] }));
  assert.equal(hits.length, 1);
});

test("searchRpoByName throws with the status when RPO refuses the query", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 400 }) as Response) as typeof fetch;
  await assert.rejects(searchRpoByName("sro", fetchImpl), /RPO search failed: HTTP 400/);
});
