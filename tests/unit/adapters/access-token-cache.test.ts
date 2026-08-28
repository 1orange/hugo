import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccessTokenCache } from "../../../src/adapters/drive/google-drive-client.ts";

test("reuses the token until it approaches expiry, then refreshes", async () => {
  let issued = 0;
  let clock = 0;
  const getToken = createAccessTokenCache(
    async () => {
      issued += 1;
      return { token: `token-${issued}`, expiresInSeconds: 3600 };
    },
    () => clock,
  );

  assert.equal(await getToken(), "token-1");
  clock += 30 * 60 * 1000;
  assert.equal(await getToken(), "token-1");
  assert.equal(issued, 1);

  clock += 30 * 60 * 1000;
  assert.equal(await getToken(), "token-2");
  assert.equal(issued, 2);
});

test("a failed exchange is not cached and does not wedge later sweeps", async () => {
  let attempts = 0;
  const getToken = createAccessTokenCache(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("network blip");
    }
    return { token: "token-after-recovery", expiresInSeconds: 3600 };
  });

  await assert.rejects(getToken(), /network blip/);
  assert.equal(await getToken(), "token-after-recovery");
});
