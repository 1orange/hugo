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
import {
  assertMonthEditable,
  closeCompanyMonth,
  reopenCompanyMonth,
  ensureAllOpenMonthsScaffolded,
} from "@/lib/month-lifecycle/service";
import { createEkasaLookup } from "@/adapters/ekasa-lookup/create-ekasa-lookup";
import {
  confirmDocument,
  dismissDocument,
  saveDocumentFields,
  saveDocumentNote,
} from "@/lib/documents/service";
import { lookupEkasaUidForDocument } from "@/lib/documents/lookup-ekasa-uid";
import { runSweep } from "@/lib/sweep/run-sweep";
import { revalidatePath } from "next/cache";

export async function refreshSweepAction(): Promise<{ sweepAt: string }> {
  const parentFolderId = requireDriveParentFolderId();
  const stored = resolveDriveParentFolderId();
  if (!stored) {
    setDriveParentFolderId(parentFolderId);
  }

  const driveClient = createDriveClient();
  const result = await runSweep(driveClient);
  await ensureAllOpenMonthsScaffolded(driveClient);
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
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  if (!resolveDriveParentFolderId()) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  const monthFolders = listMonthFolders(input.companyId, input.monthKey);
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
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  if (!resolveDriveParentFolderId()) {
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
  if (!resolveDriveParentFolderId()) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  const result = await closeCompanyMonth(
    createDriveClient(),
    input.companyId,
    input.monthKey,
  );
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
  driveFileId: string;
  confirmed: boolean;
}): Promise<MutationActionResult> {
  const result = confirmDocument(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function confirmDocumentFormAction(
  formData: FormData,
): Promise<void> {
  await confirmDocumentAction({
    companyId: Number(formData.get("companyId")),
    monthKey: String(formData.get("monthKey") ?? ""),
    driveFileId: String(formData.get("driveFileId") ?? ""),
    confirmed: formData.get("confirmed") === "true",
  });
}

export async function dismissDocumentAction(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  reason?: string;
}): Promise<MutationActionResult> {
  const result = dismissDocument(input);
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
    driveFileId: String(formData.get("driveFileId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
}

export async function saveDocumentNoteAction(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  note: string;
}): Promise<MutationActionResult> {
  const result = saveDocumentNote(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}

export async function lookupEkasaUidAction(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  uid: string;
}): Promise<
  | { ok: true; found: true }
  | { ok: true; found: false; message: string }
  | { ok: false; message: string }
> {
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
  driveFileId: string;
  fields: {
    supplierName: string;
    ico: string;
    dic: string;
    icDph: string;
    receiptNumber: string;
    receiptTimestampRaw: string;
    currency: string;
    amountLiteral: string;
    recapBaseLiteral: string;
    recapVatLiteral: string;
    vatRecap: Array<{
      rateLiteral: string;
      baseLiteral: string;
      vatLiteral: string;
    }>;
  };
}): Promise<MutationActionResult> {
  const result = saveDocumentFields(input);
  if (result.ok) {
    revalidateMonth(input.companyId, input.monthKey);
  }
  return result;
}
