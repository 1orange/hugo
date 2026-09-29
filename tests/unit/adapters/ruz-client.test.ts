import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupRuzByIco } from "../../../src/adapters/company-register/ruz-client.ts";

// Shapes as registeruz.sk returned them on 2026-09-29.
const SLOVNAFT = {
  id: 449752,
  ico: "31322832",
  dic: "2020372640",
  nazovUJ: "SLOVNAFT, a.s.",
  mesto: "Bratislava - mestská časť Ružinov",
  ulica: "Vlčie hrdlo 1",
  psc: "82107",
  datumPoslednejUpravy: "2026-07-03",
};

const WITHDRAWN = { id: 1051838, stav: "ZMAZANÉ", datumPoslednejUpravy: "2024-05-31" };

function registerUz(units: Record<number, unknown>, idsByIco: Record<string, number[]>, urls: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    if (url.pathname.endsWith("/uctovne-jednotky")) {
      if (!url.searchParams.get("zmenene-od")) {
        // The register's firewall answers a list without the date so.
        return { ok: false, status: 403 } as Response;
      }
      const ids = idsByIco[url.searchParams.get("ico") ?? ""] ?? [];
      return { ok: true, status: 200, json: async () => ({ id: ids, existujeDalsieId: false }) } as Response;
    }
    const unit = units[Number(url.searchParams.get("id"))];
    return unit
      ? ({ ok: true, status: 200, json: async () => unit } as Response)
      : ({ ok: false, status: 404 } as Response);
  }) as typeof fetch;
}

test("lookupRuzByIco lists the IČO's units, then reads the live one", async () => {
  const urls: string[] = [];
  const lookup = await lookupRuzByIco(
    "31322832",
    registerUz({ 449752: SLOVNAFT, 1051838: WITHDRAWN }, { "31322832": [449752, 1051838] }, urls),
  );
  assert.deepEqual(lookup, {
    country: "SK",
    ico: "31322832",
    legalName: "SLOVNAFT, a.s.",
    address: "Vlčie hrdlo 1, 821 07 Bratislava - mestská časť Ružinov",
    dic: "2020372640",
  });
  assert.match(urls[0]!, /^https:\/\/www\.registeruz\.sk\/cruz-public\/api\/uctovne-jednotky\?zmenene-od=/);
});

test("lookupRuzByIco returns null for an IČO the register does not hold", async () => {
  assert.equal(await lookupRuzByIco("99999999", registerUz({}, {})), null);
});

test("lookupRuzByIco returns null when every unit was withdrawn", async () => {
  assert.equal(
    await lookupRuzByIco("31322832", registerUz({ 1051838: WITHDRAWN }, { "31322832": [1051838] })),
    null,
  );
});

test("lookupRuzByIco throws with the status when the register fails", async () => {
  const fetchImpl = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;
  await assert.rejects(lookupRuzByIco("31322832", fetchImpl), /RÚZ lookup failed: HTTP 503/);
});
