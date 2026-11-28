import type { DriveClient } from "@/adapters/drive/port";
import { listDocumentsForFile, ensureDocumentsForMonth } from "@/adapters/store/documents";
import {
  getMutationById,
  insertPendingMutation,
  markMutationApplied,
  markMutationFailed,
  markMutationUndone,
} from "@/adapters/store/drive-mutations";
import { appendUserEvent } from "@/adapters/store/events";
import { getFileByDriveId } from "@/adapters/store/files";
import {
  getLateArrival,
  listLateArrivalsForCompany,
  setLateArrivalStatus,
  type LateArrivalRow,
} from "@/adapters/store/late-arrivals";
import { getMonthFolder, listMonthFolders } from "@/adapters/store/month-folders";
import { getLateArrivalTargetMonthKey, getMonthByKey } from "@/adapters/store/months";
import { getSettings } from "@/adapters/store/settings";
import { announce } from "@/lib/events/bus";
import { runSweep } from "@/lib/sweep/run-sweep";
import { recordDriveMove } from "@/adapters/store/drive-snapshot";
import { classifyFolder } from "@/modules/folder-taxonomy";
import {
  assessLateArrival,
  lateArrivalWarningText,
  type LateArrivalAssessment,
  type LateArrivalStatus,
} from "@/modules/late-arrivals";

/**
 * Late arrivals (ADR 0005, ADR 0006, amended 2026-11-12): the sweep keeps the
 * log; she moves the pending ones into the open month in one batch per company,
 * ignores one, or undoes a move. Every move is recorded before Drive is touched.
 */

export type LateArrivalItem = {
  id: number;
  driveFileId: string;
  name: string;
  sourceMonthKey: string;
  folderSlot: string;
  arrivedAt: string;
  status: LateArrivalStatus;
  /** For a pending one: the move proposed, or why there is none. */
  assessment: LateArrivalAssessment | null;
  /** The warning in Slovak, when the assessment is one. */
  warning: string | null;
  targetMonthKey: string | null;
  /** For a moved one: whether the move can be undone now. */
  canUndo: boolean;
};

export type LateArrivalsView = {
  targetMonthKey: string | null;
  /** Pending, oldest first: proposals and warnings. */
  pending: LateArrivalItem[];
  /** Moved into the target month and not undone, newest first. */
  moved: LateArrivalItem[];
  /** How many the batch would move now. */
  movableCount: number;
};

type Destination = { name: string; driveFolderId: string; observedName: string };

async function assess(
  entry: LateArrivalRow,
  context: { targetMonthKey: string | null; movableFolderNames: string[]; destinations: Destination[] },
): Promise<{ assessment: LateArrivalAssessment; canMove: boolean; name: string }> {
  const file = await getFileByDriveId(entry.driveFileId);
  const canMove = file?.canMove ?? true;
  // Where the open month has several folders of the type (`04 Platby hotovosťou` and
  // `05 Platby kartou` are both receipts), the one named like the folder it came from.
  const sourceName = (await getMonthFolder(entry.sourceParentId))?.name ?? null;
  const destinations = [...context.destinations].sort(
    (left, right) => Number(right.observedName === sourceName) - Number(left.observedName === sourceName),
  );
  const assessment = assessLateArrival({
    folderSlot: entry.folderSlot,
    canMove,
    movableFolderNames: context.movableFolderNames,
    targetMonthKey: context.targetMonthKey,
    sourceMonthKey: entry.sourceMonthKey,
    destinationFolders: destinations,
  });
  return { assessment, canMove, name: file?.name ?? entry.driveFileId };
}

async function moveContext(companyId: number) {
  const [settings, targetMonthKey] = await Promise.all([getSettings(), getLateArrivalTargetMonthKey(companyId)]);
  // A destination is named by the type it is: an older folder name (`04 Platby hotovosťou`) too.
  const destinations: Destination[] = targetMonthKey
    ? (await listMonthFolders(companyId, targetMonthKey)).flatMap((folder) => {
        const classification = classifyFolder(
          folder.name,
          { canonicalFolderNames: settings.canonicalFolderNames },
          targetMonthKey,
        );
        return classification.kind === "canonical"
          ? [{ name: classification.name, driveFolderId: folder.driveFolderId, observedName: folder.name }]
          : [];
      })
    : [];
  return { targetMonthKey, movableFolderNames: settings.movableFolderNames, destinations };
}

/** The company's late arrivals as the screen shows them. */
export async function loadLateArrivalsView(companyId: number): Promise<LateArrivalsView> {
  const context = await moveContext(companyId);
  const entries = await listLateArrivalsForCompany(companyId);
  const pending: LateArrivalItem[] = [];
  const moved: LateArrivalItem[] = [];
  for (const entry of entries) {
    if (entry.status === "pending") {
      const { assessment, name } = await assess(entry, context);
      pending.push({
        ...itemOf(entry, name),
        assessment,
        warning: assessment.kind === "warning" ? lateArrivalWarningText(assessment, entry.folderSlot) : null,
      });
    } else if (entry.status === "moved" && entry.mutationId !== null) {
      const mutation = await getMutationById(entry.mutationId);
      if (!mutation || mutation.undoneAt) {
        continue;
      }
      const file = await getFileByDriveId(entry.driveFileId);
      moved.push({
        ...itemOf(entry, file?.name ?? entry.driveFileId),
        canUndo: (await undoBlock(entry)) === null,
      });
    }
  }
  moved.sort((left, right) => right.id - left.id);
  return {
    targetMonthKey: context.targetMonthKey,
    pending,
    moved,
    movableCount: pending.filter((item) => item.assessment?.kind === "move").length,
  };
}

function itemOf(entry: LateArrivalRow, name: string): LateArrivalItem {
  return {
    id: entry.id,
    driveFileId: entry.driveFileId,
    name,
    sourceMonthKey: entry.sourceMonthKey,
    folderSlot: entry.folderSlot,
    arrivedAt: entry.arrivedAt,
    status: entry.status,
    assessment: null,
    warning: null,
    targetMonthKey: entry.targetMonthKey,
    canUndo: false,
  };
}

export type MoveLateArrivalsResult =
  | { ok: true; moved: number; failed: Array<{ name: string; message: string }> }
  | { ok: false; message: string };

/**
 * Moves every pending late arrival the screen proposes a move for into the open
 * month, same folder (ADR 0006): one confirmation for the batch. Each move is
 * recorded before Drive is touched and marked applied only once Drive confirms;
 * one refused move does not stop the others. `ids` limits the batch.
 */
export async function moveLateArrivals(input: {
  driveClient: DriveClient;
  companyId: number;
  ids?: number[];
  now?: () => string;
}): Promise<MoveLateArrivalsResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const context = await moveContext(input.companyId);
  if (!context.targetMonthKey) {
    return { ok: false, message: "Nie je mesiac, do ktorého by sa doklady presunuli: spracúvaný mesiac je uzavretý alebo chýba." };
  }
  const wanted = input.ids ? new Set(input.ids) : null;
  const entries = (await listLateArrivalsForCompany(input.companyId)).filter(
    (entry) => entry.status === "pending" && (!wanted || wanted.has(entry.id)),
  );

  let moved = 0;
  const failed: Array<{ name: string; message: string }> = [];
  for (const entry of entries) {
    const { assessment, name } = await assess(entry, context);
    if (assessment.kind !== "move") {
      continue;
    }
    const mutation = await insertPendingMutation({
      kind: "move",
      driveFileId: entry.driveFileId,
      companyId: input.companyId,
      previousParent: entry.sourceParentId,
      previousName: name,
      newParent: assessment.targetFolderId,
      newName: name,
      intendedAt: now(),
    });
    try {
      await input.driveClient.move(entry.driveFileId, entry.sourceParentId, assessment.targetFolderId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Drive refused the move";
      await markMutationFailed(mutation.id, message);
      failed.push({ name, message: `Drive presun odmietol: ${message}` });
      continue;
    }
    await recordDriveMove(entry.driveFileId, entry.sourceParentId, assessment.targetFolderId);
    const appliedAt = now();
    await markMutationApplied(mutation.id, appliedAt);
    await setLateArrivalStatus(entry.id, "moved", appliedAt, {
      targetMonthKey: assessment.targetMonthKey,
      mutationId: mutation.id,
    });
    await appendUserEvent(appliedAt, input.companyId, "Moved", {
      driveFileId: entry.driveFileId,
      name,
      folderSlot: entry.folderSlot,
      fromMonthKey: entry.sourceMonthKey,
      toMonthKey: assessment.targetMonthKey,
      previousParent: entry.sourceParentId,
      newParent: assessment.targetFolderId,
      mutationId: mutation.id,
    });
    moved += 1;
  }

  if (moved > 0) {
    await afterDriveChange(input.driveClient, input.companyId, [context.targetMonthKey, ...entries.map((entry) => entry.sourceMonthKey)], now());
  }
  return { ok: true, moved, failed };
}

/**
 * The files' new place, read back from Drive by a sweep; the documents follow
 * their file into the month it is in now, extraction and decision kept.
 */
async function afterDriveChange(driveClient: DriveClient, companyId: number, monthKeys: string[], now: string): Promise<void> {
  await runSweep(driveClient);
  const months = [...new Set(monthKeys)];
  for (const monthKey of months) {
    await ensureDocumentsForMonth(companyId, monthKey, now);
  }
  announce({ type: "files-changed", months: months.map((monthKey) => ({ companyId, monthKey })) });
}

/** Why a move cannot be undone now; null when it can. */
async function undoBlock(entry: LateArrivalRow): Promise<string | null> {
  if (entry.mutationId === null) {
    return "Presun sa nenašiel.";
  }
  const mutation = await getMutationById(entry.mutationId);
  if (!mutation || mutation.undoneAt || mutation.kind !== "move") {
    return "Presun sa nenašiel alebo už bol vrátený.";
  }
  if (mutation.status !== "applied") {
    return "Presun nebol v Drive potvrdený, nie je čo vrátiť.";
  }
  const file = await getFileByDriveId(entry.driveFileId);
  if (!file || file.deleted) {
    return "Doklad už v Drive nie je.";
  }
  if (file.parentId !== mutation.newParent) {
    // Someone moved it again since: undo would discard that.
    return "Doklad bol odvtedy v Drive presunutý inam, vrátenie by ten presun zrušilo.";
  }
  const documents = await listDocumentsForFile(entry.driveFileId);
  if (documents.some((document) => document.decision !== null || document.exportedAt !== null)) {
    return "Doklad je už v novom mesiaci rozhodnutý, presun sa nedá vrátiť.";
  }
  if (entry.targetMonthKey) {
    const target = await getMonthByKey(entry.companyId, entry.targetMonthKey);
    if (target?.closedAt) {
      return "Mesiac, do ktorého bol doklad presunutý, je už uzavretý.";
    }
  }
  return null;
}

export type LateArrivalActionResult = { ok: true } | { ok: false; message: string };

/**
 * Puts a moved late arrival back where it arrived, and back on the list as
 * pending. Refused when the file was moved again since, or decided in its new month.
 */
export async function undoLateArrivalMove(input: {
  driveClient: DriveClient;
  companyId: number;
  lateArrivalId: number;
  now?: () => string;
}): Promise<LateArrivalActionResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const entry = await getLateArrival(input.lateArrivalId);
  if (!entry || entry.companyId !== input.companyId || entry.status !== "moved") {
    return { ok: false, message: "Presunutý doklad sa nenašiel." };
  }
  const blocked = await undoBlock(entry);
  if (blocked) {
    return { ok: false, message: blocked };
  }
  const mutation = (await getMutationById(entry.mutationId!))!;
  try {
    await input.driveClient.move(entry.driveFileId, mutation.newParent, mutation.previousParent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive refused the move";
    return { ok: false, message: `Drive vrátenie odmietol: ${message}` };
  }
  await recordDriveMove(entry.driveFileId, mutation.newParent, mutation.previousParent);
  const undoneAt = now();
  await markMutationUndone(mutation.id, undoneAt);
  await setLateArrivalStatus(entry.id, "pending", undoneAt);
  await appendUserEvent(undoneAt, input.companyId, "Moved", {
    driveFileId: entry.driveFileId,
    name: mutation.newName,
    folderSlot: entry.folderSlot,
    fromMonthKey: entry.targetMonthKey,
    toMonthKey: entry.sourceMonthKey,
    previousParent: mutation.newParent,
    newParent: mutation.previousParent,
    mutationId: mutation.id,
    undone: true,
  });
  await afterDriveChange(
    input.driveClient,
    input.companyId,
    [entry.sourceMonthKey, ...(entry.targetMonthKey ? [entry.targetMonthKey] : [])],
    undoneAt,
  );
  return { ok: true };
}

/**
 * Takes a pending late arrival off the list (a duplicate upload), or puts an
 * ignored one back. Nothing in Drive changes.
 */
export async function setLateArrivalIgnored(input: {
  companyId: number;
  lateArrivalId: number;
  ignored: boolean;
  now?: string;
}): Promise<LateArrivalActionResult> {
  const now = input.now ?? new Date().toISOString();
  const entry = await getLateArrival(input.lateArrivalId);
  const from: LateArrivalStatus = input.ignored ? "pending" : "ignored";
  if (!entry || entry.companyId !== input.companyId || entry.status !== from) {
    return { ok: false, message: "Neskorý doklad sa nenašiel." };
  }
  await setLateArrivalStatus(entry.id, input.ignored ? "ignored" : "pending", now);
  await appendUserEvent(now, input.companyId, "LateArrivalIgnored", {
    driveFileId: entry.driveFileId,
    monthKey: entry.sourceMonthKey,
    ignored: input.ignored,
  });
  return { ok: true };
}
