import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lookupAresByIco,
  searchAresByName,
} from "../../../src/adapters/company-register/ares-client.ts";

test("searchAresByName maps ARES search hits", async () => {
  const fetchImpl = async () =>
    ({
      ok: true,
      json: async () => ({
        ekonomickeSubjekty: [
          {
            ico: "12345678",
            obchodniJmeno: "Test s.r.o.",
            dic: "CZ12345678",
            sidlo: { textovaAdresa: "Praha 1" },
            seznamRegistraci: { stavZdrojeRos: "AKTIVNI" },
          },
        ],
      }),
    }) as Response;

  const hits = await searchAresByName("Test", fetchImpl);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.ico, "12345678");
  assert.equal(hits[0]!.status, "active");
});

test("lookupAresByIco returns null on 404", async () => {
  const fetchImpl = async () =>
    ({
      ok: false,
      status: 404,
    }) as Response;

  assert.equal(await lookupAresByIco("99999999", fetchImpl), null);
});
