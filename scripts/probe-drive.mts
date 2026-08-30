/**
 * Read-only probe of the live Drive. Answers PRD open questions 4 and 5:
 * whether client-uploaded files are movable, and whether every company folder
 * sits under one shared parent. Deliberately self-contained: no imports from
 * src/, so a refactor in flight cannot break it. Performs no mutations.
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2]!.trim();
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]!] = v;
  }
  return out;
}

const env = readEnv();
const creds = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON!) as {
  client_email: string;
  private_key: string;
};
const parentId = env.DRIVE_PARENT_FOLDER_ID!;

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const now = Math.floor(Date.now() / 1000);
const claim = {
  iss: creds.client_email,
  scope: "https://www.googleapis.com/auth/drive.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
};
const signingInput = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;
const signer = createSign("RSA-SHA256");
signer.update(signingInput);
const jwt = `${signingInput}.${b64url(signer.sign(creds.private_key.replace(/\\n/g, "\n")))}`;

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }),
});
if (!tokenRes.ok) {
  console.error("token exchange failed", tokenRes.status, await tokenRes.text());
  process.exit(1);
}
const { access_token } = (await tokenRes.json()) as { access_token: string };
console.log("authenticated as", creds.client_email);

type Rec = {
  id: string;
  name: string;
  parents?: string[];
  mimeType: string;
  createdTime: string;
  capabilities?: { canRename?: boolean; canMoveItemWithinDrive?: boolean };
  owners?: Array<{ emailAddress?: string }>;
};

const files: Rec[] = [];
let pageToken: string | undefined;
do {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", "trashed=false");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set(
    "fields",
    "nextPageToken,files(id,name,parents,mimeType,createdTime,capabilities/canRename,capabilities/canMoveItemWithinDrive,owners/emailAddress)",
  );
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!res.ok) {
    console.error("list failed", res.status, await res.text());
    process.exit(1);
  }
  const body = (await res.json()) as { files: Rec[]; nextPageToken?: string };
  files.push(...body.files);
  pageToken = body.nextPageToken;
} while (pageToken);

const FOLDER = "application/vnd.google-apps.folder";
const byId = new Map(files.map((f) => [f.id, f]));
console.log(`\ntotal visible items: ${files.length}`);

function underParent(rec: Rec): boolean {
  let cur: Rec | undefined = rec;
  for (let i = 0; i < 20 && cur; i += 1) {
    const p = cur.parents?.[0];
    if (!p) return false;
    if (p === parentId) return true;
    cur = byId.get(p);
  }
  return false;
}

const docs = files.filter((f) => f.mimeType !== FOLDER);
const inTree = docs.filter(underParent);
console.log(`documents: ${docs.length}, of which under the configured parent: ${inTree.length}`);
console.log(`companies directly under parent: ${files.filter((f) => f.mimeType === FOLDER && f.parents?.[0] === parentId).length}`);

const notMovable = inTree.filter((f) => f.capabilities?.canMoveItemWithinDrive === false);
const notRenamable = inTree.filter((f) => f.capabilities?.canRename === false);
const missingCap = inTree.filter((f) => f.capabilities?.canMoveItemWithinDrive === undefined);
console.log(`\ncanMoveItemWithinDrive === false : ${notMovable.length}`);
console.log(`canRename === false             : ${notRenamable.length}`);
console.log(`capability not reported         : ${missingCap.length}`);

// Counts only, never names or addresses: this is a client's confidential
// financial data and the answer needed is statistical.
const distinctOwners = new Set(
  inTree.map((f) => f.owners?.[0]?.emailAddress ?? "(unknown)"),
).size;
const notOwnedByUs = inTree.filter(
  (f) => f.owners?.[0]?.emailAddress && f.owners[0].emailAddress !== creds.client_email,
);
console.log(`\ndistinct document owners: ${distinctOwners}`);
console.log(`documents owned by someone other than the service account: ${notOwnedByUs.length}`);
console.log(
  `  of those, movable: ${notOwnedByUs.filter((f) => f.capabilities?.canMoveItemWithinDrive === true).length}` +
    `, not movable: ${notOwnedByUs.filter((f) => f.capabilities?.canMoveItemWithinDrive === false).length}` +
    `, unreported: ${notOwnedByUs.filter((f) => f.capabilities?.canMoveItemWithinDrive === undefined).length}`,
);

const nfd = inTree.filter((f) => f.name !== f.name.normalize("NFC"));
console.log(`\ndocument names arriving as NFD: ${nfd.length}`);
const folders = files.filter((f) => f.mimeType === FOLDER);
console.log(`folder names arriving as NFD:   ${folders.filter((f) => f.name !== f.name.normalize("NFC")).length} of ${folders.length}`);
