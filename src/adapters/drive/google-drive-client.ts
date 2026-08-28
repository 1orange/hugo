import { createSign } from "node:crypto";
import type { DriveFileRecord } from "@/modules/drive-tree";
import type { DriveClient } from "./port";

type GoogleCredentials = {
  client_email: string;
  private_key: string;
};

type ListResponse = {
  files?: Array<{
    id?: string | null;
    name?: string | null;
    parents?: string[] | null;
    createdTime?: string | null;
    mimeType?: string | null;
    capabilities?: {
      canRename?: boolean | null;
      canMoveItemWithinDrive?: boolean | null;
    } | null;
  }>;
  nextPageToken?: string | null;
};

const LIST_FIELDS =
  "nextPageToken,files(id,name,parents,createdTime,mimeType,capabilities/canRename,capabilities/canMoveItemWithinDrive)";
const PAGE_SIZE = 1000;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export class GoogleDriveClient implements DriveClient {
  private readonly getAccessToken: () => Promise<string>;

  constructor(
    private readonly credentials: GoogleCredentials,
    private readonly pageFetcher: (
      pageToken?: string,
    ) => Promise<ListResponse> = createPageFetcher(credentials),
  ) {
    this.getAccessToken = createAccessTokenCache(() =>
      fetchAccessToken(credentials),
    );
  }

  async list(): Promise<DriveFileRecord[]> {
    const records: DriveFileRecord[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.pageFetcher(pageToken);
      for (const file of response.files ?? []) {
        if (!file.id || !file.name || !file.mimeType || !file.createdTime) {
          continue;
        }
        records.push({
          id: file.id,
          name: file.name,
          parents: file.parents ?? [],
          createdTime: file.createdTime,
          mimeType: file.mimeType,
          capabilities: file.capabilities
            ? {
                canRename: file.capabilities.canRename ?? true,
                canMoveItemWithinDrive:
                  file.capabilities.canMoveItemWithinDrive ?? true,
              }
            : undefined,
        });
      }
      pageToken = response.nextPageToken ?? undefined;
    } while (pageToken);

    return records;
  }

  async rename(fileId: string, newName: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      },
    );
    if (!response.ok) {
      throw new Error(`Drive files.update failed with status ${response.status}`);
    }
  }
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createServiceAccountJwt(credentials: GoogleCredentials): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: credentials.client_email,
      scope: DRIVE_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(credentials.private_key);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

export type AccessToken = { token: string; expiresInSeconds: number };

async function fetchAccessToken(
  credentials: GoogleCredentials,
): Promise<AccessToken> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createServiceAccountJwt(credentials),
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed with status ${response.status}`);
  }
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("Google token exchange returned no access token");
  }
  return {
    token: json.access_token,
    expiresInSeconds: json.expires_in ?? 3600,
  };
}

/**
 * Caches the access token until shortly before it expires. A failed exchange is
 * deliberately not cached: a single network blip must not wedge every later
 * sweep until the service is restarted.
 */
export function createAccessTokenCache(
  fetchToken: () => Promise<AccessToken>,
  now: () => number = Date.now,
): () => Promise<string> {
  const EXPIRY_MARGIN_MS = 60_000;
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && now() < cached.expiresAt) {
      return cached.token;
    }

    const { token, expiresInSeconds } = await fetchToken();
    cached = {
      token,
      expiresAt: now() + Math.max(expiresInSeconds * 1000 - EXPIRY_MARGIN_MS, 0),
    };
    return token;
  };
}

function createPageFetcher(credentials: GoogleCredentials) {
  const getAccessToken = createAccessTokenCache(() =>
    fetchAccessToken(credentials),
  );

  return async (pageToken?: string): Promise<ListResponse> => {
    const accessToken = await getAccessToken();
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", "trashed=false");
    url.searchParams.set("fields", LIST_FIELDS);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Drive files.list failed with status ${response.status}`);
    }
    return (await response.json()) as ListResponse;
  };
}

export function loadGoogleDriveClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GoogleDriveClient {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is required");
  }

  const credentials = JSON.parse(raw) as GoogleCredentials;
  return new GoogleDriveClient(credentials);
}
