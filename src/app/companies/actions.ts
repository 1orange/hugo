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
import {
  confirmPayment,
  pairPaymentWithProof,
  savePaymentNote,
  saveProofNote,
  unpairPaymentFromProof,
} from "@/lib/reconciliation/service";
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

function revalidateReconciliation(companyId: number, monthKey: string): void {
  revalidatePath(`/companies/${companyId}/${monthKey}/reconcile`);
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

export async function pairPaymentAction(input: {
  companyId: number;
  monthKey: string;
  paymentId: number;
  proofDriveFileId: string;
}): Promise<MutationActionResult> {
  const result = pairPaymentWithProof(input);
  if (result.ok) {
    revalidateReconciliation(input.companyId, input.monthKey);
  }
  return result;
}

export async function pairPaymentFormAction(
  formData: FormData,
): Promise<void> {
  await pairPaymentAction({
    companyId: Number(formData.get("companyId")),
    monthKey: String(formData.get("monthKey") ?? ""),
    paymentId: Number(formData.get("paymentId")),
    proofDriveFileId: String(formData.get("proofDriveFileId") ?? ""),
  });
}

export async function unpairPaymentAction(input: {
  companyId: number;
  monthKey: string;
  pairingId: number;
}): Promise<MutationActionResult> {
  const result = unpairPaymentFromProof(input);
  if (result.ok) {
    revalidateReconciliation(input.companyId, input.monthKey);
  }
  return result;
}

export async function confirmPaymentAction(input: {
  companyId: number;
  monthKey: string;
  paymentId: number;
  confirmed: boolean;
}): Promise<MutationActionResult> {
  const result = confirmPayment(input);
  if (result.ok) {
    revalidateReconciliation(input.companyId, input.monthKey);
  }
  return result;
}

export async function confirmPaymentFormAction(
  formData: FormData,
): Promise<void> {
  await confirmPaymentAction({
    companyId: Number(formData.get("companyId")),
    monthKey: String(formData.get("monthKey") ?? ""),
    paymentId: Number(formData.get("paymentId")),
    confirmed: formData.get("confirmed") === "true",
  });
}

export async function savePaymentNoteAction(input: {
  companyId: number;
  monthKey: string;
  paymentId: number;
  note: string;
}): Promise<MutationActionResult> {
  const result = savePaymentNote(input);
  if (result.ok) {
    revalidateReconciliation(input.companyId, input.monthKey);
  }
  return result;
}

export async function saveProofNoteAction(input: {
  companyId: number;
  monthKey: string;
  proofDriveFileId: string;
  note: string;
}): Promise<MutationActionResult> {
  const result = saveProofNote(input);
  if (result.ok) {
    revalidateReconciliation(input.companyId, input.monthKey);
  }
  return result;
}
