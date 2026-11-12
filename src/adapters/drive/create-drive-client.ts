import { FakeDriveClient } from "@/adapters/drive/fake-drive-client";
import { loadGoogleDriveClientFromEnv } from "@/adapters/drive/google-drive-client";
import type { DriveClient } from "@/adapters/drive/port";
import { e2eDriveFileContents, e2eDriveFixture } from "@/adapters/drive/e2e-fixture";
import type { DriveFileRecord } from "@/modules/drive-tree";

export function createDriveClient(
  env: NodeJS.ProcessEnv = process.env,
): DriveClient {
  if (env.DRIVE_CLIENT === "fake") {
    // Silently syncing a fabricated tree over real client folders would look
    // like data loss rather than a misconfiguration.
    if (env.NODE_ENV === "production") {
      throw new Error(
        "DRIVE_CLIENT=fake must never be used in production: it replaces real Drive contents with fixture data",
      );
    }

    const fixture = env.DRIVE_FIXTURE_JSON;
    if (fixture) {
      return new FakeDriveClient(JSON.parse(fixture) as DriveFileRecord[]);
    }
    return e2eFakeDrive();
  }

  return loadGoogleDriveClientFromEnv(env);
}

/**
 * The e2e Drive, one per server process: a move made by one action is still
 * there for the next sweep, as in a real Drive. Kept on globalThis because the
 * dev server may load this module more than once. The e2e reset starts it afresh.
 */
const E2E_DRIVE = Symbol.for("hugo.e2eFakeDrive");

function e2eFakeDrive(): FakeDriveClient {
  const holder = globalThis as unknown as Record<symbol, FakeDriveClient | undefined>;
  holder[E2E_DRIVE] ??= new FakeDriveClient(e2eDriveFixture(), e2eDriveFileContents());
  return holder[E2E_DRIVE];
}

/** A fresh e2e Drive, as the fixture describes it. */
export function resetE2eFakeDrive(): FakeDriveClient {
  (globalThis as unknown as Record<symbol, FakeDriveClient | undefined>)[E2E_DRIVE] = undefined;
  return e2eFakeDrive();
}
