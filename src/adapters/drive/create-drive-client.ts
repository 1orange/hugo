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
    return new FakeDriveClient(e2eDriveFixture(), e2eDriveFileContents());
  }

  return loadGoogleDriveClientFromEnv(env);
}
