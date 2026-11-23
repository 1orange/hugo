"use server";

import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { listMonthFolders } from "@/adapters/store/month-folders";
import {
  requireDriveParentFolderId,
  resolveDriveParentFolderId,
  setDriveParentFolderId,
} from "@/adapters/store/settings";
import {
  applyFolderRename,
  undoFolderRename,
} from "@/lib/drive-mutations/apply-rename";
import { companyActionRefusal } from "@/lib/access/guard";
import {
  assertMonthEditable,
  closeCompanyMonth,
  reopenCompanyMonth,
} from "@/lib/month-lifecycle/service";
import { createEkasaLookup } from "@/adapters/ekasa-lookup/create-ekasa-lookup";
import {
  confirmDocument,
  dismissDocument,
  saveDocumentFields,
  saveDocumentNote,
  setAdvanceSettlement,
  swapDocumentParties,
  takePartyFromRegister,
} from "@/lib/documents/service";
import { lookupEkasaUidForDocument } from "@/lib/documents/lookup-ekasa-uid";
import { requestDocumentReextraction } from "@/lib/documents/reextract-document";
import { scheduleDocumentExtractionForMonth } from "@/lib/cash-discovery/schedule";
import { runSweep } from "@/lib/sweep/run-sweep";
import {
  moveLateArrivals,
  setLateArrivalIgnored,
  undoLateArrivalMove,
} from "@/lib/late-arrivals/service";
import type { DocumentFieldFormInput } from "@/modules/document-fields";
import type { PartySwapProvenance } from "@/modules/party-swap";
import { revalidatePath } from "next/cache";

/*
 * Every action that takes a company id (directly, or through its document) starts
 * with the visibility guard (ADR 0023). A company the person may not see is refused
 * with the same message as a missing one, and nothing is read or written.
 */

export async function refreshSweepAction(): Promise<{ sweepAt: string }> {
  const parentFolderId = await requireDriveParentFolderId();
  const stored = await resolveDriveParentFolderId();
  if (!stored) {
    await setDriveParentFolderId(parentFolderId);
  }

  // *Obnoviť* reads every company's sharing too: the person asked for a fresh picture.
  const result = await runSweep(createDriveClient(), { allAccess: true });
  revalidatePath("/companies");
  return { sweepAt: result.sweepAt };
}

type MutationActionResult =
  | { ok: true }
  | { ok: false; message: string };

function revalidateMonth(companyId: number, monthKey: string): void {
  revalidatePath(`/companies/${companyId}/${monthKey}`);
  revalidatePath("/companies");
}

export async function confirmFolderRenameAction(input: {
  companyId: number;
  monthKey: string;
  driveFolderId: string;
  targetName: string;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  if (!await resolveDriveParentFolderId()) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  const monthFolders = await listMonthFolders(input.companyId, input.monthKey);
  const folder = monthFolders.find(
    (entry) => entry.driveFolderId === input.driveFolderId,
  );
  if (!folder) {
    return { ok: false, message: "Folder not found in this month." };
  }

  const driveClient = createDriveClient();
  const result = await applyFolderRename(driveClient, input.companyId, {
    driveFileId: input.driveFolderId,
    currentName: folder.name,
    targetName: input.targetName,
    parentId: folder.parentId,
    capabilities: { canRename: folder.canRename },
  });

  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function undoFolderRenameAction(input: {
  companyId: number;
  monthKey: string;
  mutationId: number;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  if (!await resolveDriveParentFolderId()) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  const driveClient = createDriveClient();
  const result = await undoFolderRename(driveClient, input.mutationId);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function closeMonthAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await closeCompanyMonth(input.companyId, input.monthKey);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function reopenMonthAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await reopenCompanyMonth(input.companyId, input.monthKey);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function confirmDocumentAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  confirmed: boolean;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await confirmDocument(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

/** The form posts reach the guard through the action they call. */
export async function confirmDocumentFormAction(
  formData: FormData,
): Promise<void> {
  await confirmDocumentAction({
    companyId: Number(formData.get("companyId")),
    monthKey: String(formData.get("monthKey") ?? ""),
    documentId: String(formData.get("documentId") ?? ""),
    confirmed: formData.get("confirmed") === "true",
  });
}

export async function dismissDocumentAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  reason?: string;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await dismissDocument(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function dismissDocumentFormAction(
  formData: FormData,
): Promise<void> {
  await dismissDocumentAction({
    companyId: Number(formData.get("companyId")),
    monthKey: String(formData.get("monthKey") ?? ""),
    documentId: String(formData.get("documentId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
}

export async function saveDocumentNoteAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  note: string;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await saveDocumentNote(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function reextractDocumentAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await requestDocumentReextraction({
    ...input,
    schedule: scheduleDocumentExtractionForMonth,
  });
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function lookupEkasaUidAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  uid: string;
}): Promise<
  | { ok: true; found: true }
  | { ok: true; found: false; message: string }
  | { ok: false; message: string }
> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await lookupEkasaUidForDocument({
    ...input,
    uidRaw: input.uid,
    ekasaLookup: createEkasaLookup(),
  });
  if (result.ok && result.found) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  if (result.ok && !result.found) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function saveDocumentFieldsAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await saveDocumentFields(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

/** Her decision whether the invoice is settled by an advance (PRD 0004 issue 11). */
export async function setAdvanceSettlementAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  settled: boolean;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await setAdvanceSettlement(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

/** *Prevziať z registra* for one flagged party (PRD 0004, story 34). */
export async function takePartyFromRegisterAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  side: "supplier" | "customer";
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await takePartyFromRegister(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function swapDocumentPartiesAction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
  partyProvenance: PartySwapProvenance;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await swapDocumentParties(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

/** Every month of the company: a late-arrival move changes the source month and the open one. */
function revalidateCompanyMonths(companyId: number): void {
  revalidatePath(`/companies/${companyId}`, "layout");
  revalidatePath("/companies");
}

/** Moves the company's proposed late arrivals into the open month, in one batch (ADR 0006). */
export async function moveLateArrivalsAction(input: {
  companyId: number;
  ids?: number[];
}): Promise<{ ok: true; moved: number; failed: Array<{ name: string; message: string }> } | { ok: false; message: string }> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  if (!(await resolveDriveParentFolderId())) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }
  const result = await moveLateArrivals({ driveClient: createDriveClient(), companyId: input.companyId, ids: input.ids });
  revalidateCompanyMonths(input.companyId);
  return result;
}

export async function undoLateArrivalMoveAction(input: {
  companyId: number;
  lateArrivalId: number;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  if (!(await resolveDriveParentFolderId())) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }
  const result = await undoLateArrivalMove({
    driveClient: createDriveClient(),
    companyId: input.companyId,
    lateArrivalId: input.lateArrivalId,
  });
  revalidateCompanyMonths(input.companyId);
  return result;
}

export async function setLateArrivalIgnoredAction(input: {
  companyId: number;
  lateArrivalId: number;
  ignored: boolean;
}): Promise<MutationActionResult> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const result = await setLateArrivalIgnored(input);
  revalidateCompanyMonths(input.companyId);
  return result;
}
