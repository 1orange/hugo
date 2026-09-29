"use server";

import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import {
  loadSettingsFormData,
  previewCanonicalFolderNamesChange,
  saveGlobalSettings,
} from "@/lib/settings/service";
import type { CanonicalListImpact } from "@/modules/folder-settings";
import { revalidatePath } from "next/cache";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

async function assertAllowedSettingsAccess(): Promise<
  ActionResult<never> | null
> {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    return { ok: false, message: "You must be signed in." };
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    return { ok: false, message: "You are not on the allowlist." };
  }

  return null;
}

export async function previewCanonicalImpactAction(
  proposedNames: string[],
): Promise<ActionResult<CanonicalListImpact>> {
  const denied = await assertAllowedSettingsAccess();
  if (denied) {
    return denied;
  }

  const preview = await previewCanonicalFolderNamesChange(proposedNames);
  if (!preview.ok) {
    return { ok: false, message: preview.message };
  }

  return { ok: true, data: preview.impact };
}

export async function saveSettingsAction(input: {
  driveParentFolderId: string;
  canonicalFolderNames: string[];
  movableFolderNames: string[];
  autoAdvanceAfterDecision: boolean;
}): Promise<ActionResult<{ settings: Awaited<ReturnType<typeof loadSettingsFormData>> }>> {
  const denied = await assertAllowedSettingsAccess();
  if (denied) {
    return denied;
  }

  const result = await saveGlobalSettings(input);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/settings");
  revalidatePath("/companies");
  revalidatePath("/companies", "layout");

  return {
    ok: true,
    data: { settings: await loadSettingsFormData() },
  };
}
