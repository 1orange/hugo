import { createSign } from "node:crypto";
import type { DriveFileRecord } from "@/modules/drive-tree";
import type { DriveChange, DriveChangesFeed, DriveChangesWatch, DriveClient } from "./port";

type GoogleCredentials = {
  client_email: string;
  private_key: string;
};

type ApiFile = {
  id?: string | null;
  name?: string | null;
  parents?: string[] | null;
  createdTime?: string | null;
  mimeType?: string | null;
  trashed?: boolean | null;
  capabilities?: {
    canRename?: boolean | null;
    canMoveItemWithinDrive?: boolean | null;
  } | null;
};

type ListResponse = {
  files?: ApiFile[];
  nextPageToken?: string | null;
};

type ChangesResponse = {
  changes?: Array<{ fileId?: string | null; removed?: boolean | null; file?: ApiFile | null }>;
  nextPageToken?: string | null;
  newStartPageToken?: string | null;
};

const FILE_FIELDS = "id,name,parents,createdTime,mimeType,capabilities/canRename,capabilities/canMoveItemWithinDrive";
const CHANGES_FIELDS = `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS},trashed))`;
/** Every Drive the service account sees, shared drives included, as the listing and the watch. */
const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

/** A file as the sweep needs it, or null when Drive left out a field it needs. */
function toRecord(file: ApiFile): DriveFileRecord | null {
  if (!file.id || !file.name || !file.mimeType || !file.createdTime) {
    return null;
  }
  return {
    id: file.id,
    name: file.name,
    parents: file.parents ?? [],
    createdTime: file.createdTime,
    mimeType: file.mimeType,
    capabilities: file.capabilities
      ? {
          canRename: file.capabilities.canRename ?? true,
          canMoveItemWithinDrive: file.capabilities.canMoveItemWithinDrive ?? true,
        }
      : undefined,
  };
}

const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;
const PAGE_SIZE = 1000;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export class GoogleDriveClient implements DriveClient, DriveChangesWatch, DriveChangesFeed {
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
        const record = toRecord(file);
        if (record) {
          records.push(record);
        }
      }
      pageToken = response.nextPageToken ?? undefined;
    } while (pageToken);

    return records;
  }

  async download(fileId: string): Promise<Uint8Array> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Drive files.get failed with status ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
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

  async move(fileId: string, fromParentId: string, toParentId: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("addParents", toParentId);
    url.searchParams.set("removeParents", fromParentId);
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) {
      throw new Error(`Drive files.update (move) failed with status ${response.status}`);
    }
  }

  async startPageToken(): Promise<string> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      "https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      throw new Error(`Drive changes.getStartPageToken failed with status ${response.status}`);
    }
    const { startPageToken } = (await response.json()) as { startPageToken?: string };
    if (!startPageToken) {
      throw new Error("Drive changes.getStartPageToken returned no token");
    }
    return startPageToken;
  }

  async changesSince(token: string): Promise<{ changes: DriveChange[]; newStartPageToken: string } | null> {
    const changes: DriveChange[] = [];
    let pageToken = token;
    for (;;) {
      const accessToken = await this.getAccessToken();
      const url =
        `https://www.googleapis.com/drive/v3/changes?pageToken=${encodeURIComponent(pageToken)}` +
        `&${ALL_DRIVES}&includeRemoved=true&pageSize=1000&fields=${encodeURIComponent(CHANGES_FIELDS)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      // An expired or unknown token: the caller lists everything again.
      if (response.status === 400 || response.status === 404 || response.status === 410) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Drive changes.list failed with status ${response.status}`);
      }
      const page = (await response.json()) as ChangesResponse;
      for (const change of page.changes ?? []) {
        // A change to a shared drive itself, not to a file in it.
        if (!change.fileId) {
          continue;
        }
        const record = change.file ? toRecord(change.file) : null;
        changes.push({
          fileId: change.fileId,
          // A file without a field the sweep needs is left out, as the full listing does.
          removed: change.removed === true || !record,
          file: record ? { ...record, trashed: change.file?.trashed === true } : null,
        });
      }
      if (page.newStartPageToken) {
        return { changes, newStartPageToken: page.newStartPageToken };
      }
      if (!page.nextPageToken) {
        throw new Error("Drive changes.list returned neither a next page nor a new start token");
      }
      pageToken = page.nextPageToken;
    }
  }

  async watchChanges(input: {
    channelId: string;
    token: string;
    address: string;
    expiresAt: Date;
  }): Promise<{ resourceId: string; expiresAt: string }> {
    const startPageToken = await this.startPageToken();
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/changes/watch?pageToken=${encodeURIComponent(startPageToken)}&${ALL_DRIVES}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: input.channelId,
          type: "web_hook",
          address: input.address,
          token: input.token,
          expiration: String(input.expiresAt.getTime()),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Drive changes.watch failed with status ${response.status}`);
    }
    const channel = (await response.json()) as { resourceId?: string; expiration?: string };
    if (!channel.resourceId) {
      throw new Error("Drive changes.watch returned no resource id");
    }
    // Google may shorten the lifetime it was asked for; its own is the one kept.
    const expiration = Number(channel.expiration);
    return {
      resourceId: channel.resourceId,
      expiresAt: new Date(Number.isFinite(expiration) && expiration > 0 ? expiration : input.expiresAt.getTime()).toISOString(),
    };
  }

  async stopChannel(input: { channelId: string; resourceId: string }): Promise<void> {
    const accessToken = await this.getAccessToken();
    const response = await fetch("https://www.googleapis.com/drive/v3/channels/stop", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
    });
    // A channel that already expired is gone: nothing left to stop.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Drive channels.stop failed with status ${response.status}`);
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
    // The default corpus ("user") leaves out the files of a shared drive the
    // service account is a member of: the office's clients live in one.
    url.searchParams.set("corpora", "allDrives");
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
