import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GoogleDriveClient } from "../../../src/adapters/drive/google-drive-client.ts";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const credentials = { client_email: "hugo@example.iam.gserviceaccount.com", private_key: privateKey };

const PERMISSION_FIELDS =
  "nextPageToken,permissions(type,role,emailAddress,domain,permissionDetails(inherited,permissionType,role))";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("lists a folder's permissions over every page, with the shared-drive flag, and reads inheritance per grant", async (t) => {
  const permissionUrls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.origin === "https://oauth2.googleapis.com") {
      return jsonResponse({ access_token: "token", expires_in: 3600 });
    }
    assert.equal(url.pathname, "/drive/v3/files/folder-1/permissions");
    permissionUrls.push(url);
    if (!url.searchParams.has("pageToken")) {
      return jsonResponse({
        nextPageToken: "page-2",
        permissions: [
          // A direct grant.
          {
            type: "user",
            role: "writer",
            emailAddress: "Eva@Kancelaria.sk",
            permissionDetails: [{ inherited: false, permissionType: "member", role: "writer" }],
          },
          // Granted on the parent folder only: inherited.
          {
            type: "user",
            role: "reader",
            emailAddress: "jana@kancelaria.sk",
            permissionDetails: [{ inherited: true, permissionType: "member", role: "reader" }],
          },
          // Granted directly and on the parent: the direct grant wins.
          {
            type: "group",
            role: "writer",
            emailAddress: "ucto@kancelaria.sk",
            permissionDetails: [
              { inherited: true, permissionType: "member", role: "writer" },
              { inherited: false, permissionType: "member", role: "writer" },
            ],
          },
        ],
      });
    }
    return jsonResponse({
      permissions: [{ type: "domain", role: "reader", domain: "kancelaria.sk", permissionDetails: [{ inherited: true }] }],
    });
  });

  const client = new GoogleDriveClient(credentials);
  const permissions = await client.listPermissions("folder-1");

  assert.deepEqual(permissions, [
    { type: "user", role: "writer", emailAddress: "Eva@Kancelaria.sk", domain: null, inherited: false },
    { type: "user", role: "reader", emailAddress: "jana@kancelaria.sk", domain: null, inherited: true },
    { type: "group", role: "writer", emailAddress: "ucto@kancelaria.sk", domain: null, inherited: false },
    { type: "domain", role: "reader", emailAddress: null, domain: "kancelaria.sk", inherited: true },
  ]);
  assert.equal(permissionUrls.length, 2);
  assert.equal(permissionUrls[0]!.searchParams.get("supportsAllDrives"), "true");
  assert.equal(permissionUrls[0]!.searchParams.get("fields"), PERMISSION_FIELDS);
  assert.equal(permissionUrls[1]!.searchParams.get("pageToken"), "page-2");
});

test("a refused listing is an error that names the status, not the folder", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.origin === "https://oauth2.googleapis.com") {
      return jsonResponse({ access_token: "token", expires_in: 3600 });
    }
    return new Response("{}", { status: 403 });
  });

  const client = new GoogleDriveClient(credentials);
  await assert.rejects(client.listPermissions("folder-1"), /Drive permissions\.list failed with status 403/);
});
