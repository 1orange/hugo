import { hasChangesFeed, type DriveClient } from "@/adapters/drive/port";
import { applyDriveItemChanges, listDriveItems, replaceDriveItems } from "@/adapters/store/drive-snapshot";
import { getDriveSnapshotState, saveDriveSnapshotState } from "@/adapters/store/settings";
import { needsFullListing, snapshotWritesFor } from "@/modules/drive-changes";
import type { DriveFileRecord } from "@/modules/drive-tree";

export type DriveListing = { files: DriveFileRecord[]; mode: "full" | "changes" };

/**
 * Every file the sweep diffs (ADR 0003). With a change log, the snapshot plus
 * what changed since the last sweep; a full listing the first time, once a
 * day, or when Drive no longer accepts the token. Without one, a full listing.
 */
export async function listDriveForSweep(client: DriveClient, now: Date = new Date()): Promise<DriveListing> {
  if (!hasChangesFeed(client)) {
    return { files: await client.list(), mode: "full" };
  }
  const state = await getDriveSnapshotState();
  if (!needsFullListing(state, now.getTime())) {
    const result = await client.changesSince(state.changesToken!);
    if (result) {
      await applyDriveItemChanges(snapshotWritesFor(result.changes));
      await saveDriveSnapshotState({ changesToken: result.newStartPageToken, snapshotAt: state.snapshotAt });
      return { files: await listDriveItems(), mode: "changes" };
    }
  }
  // The token first: a change made during the listing is read again next time.
  const changesToken = await client.startPageToken();
  const files = await client.list();
  await replaceDriveItems(files);
  await saveDriveSnapshotState({ changesToken, snapshotAt: now.toISOString() });
  return { files, mode: "full" };
}
