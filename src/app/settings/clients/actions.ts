"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { applyClientSheet, previewClientSheet, type ClientSheetApplied } from "@/lib/client-sheet/service";
import type { ClientSheetDecisions, ClientSheetPlan } from "@/modules/client-sheet";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function assertAllowed(): Promise<{ ok: false; message: string } | null> {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    return { ok: false, message: "Musíš byť prihlásená." };
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    return { ok: false, message: "Nemáš prístup." };
  }

  return null;
}

export async function previewClientSheetAction(text: string): Promise<ActionResult<ClientSheetPlan>> {
  const denied = await assertAllowed();
  if (denied) {
    return denied;
  }

  const preview = await previewClientSheet(text);
  if (!preview.ok) {
    return { ok: false, message: preview.message };
  }
  return { ok: true, data: preview.plan };
}

export async function applyClientSheetAction(
  text: string,
  decisions: ClientSheetDecisions,
): Promise<ActionResult<ClientSheetApplied>> {
  const denied = await assertAllowed();
  if (denied) {
    return denied;
  }

  // The payload comes from the browser: keep only what the rules can use.
  const cleaned: ClientSheetDecisions = {
    confirmedRows: Array.isArray(decisions?.confirmedRows)
      ? decisions.confirmedRows.filter((row) => Number.isInteger(row) && row > 0)
      : [],
    tickedFields: Array.isArray(decisions?.tickedFields)
      ? decisions.tickedFields.filter((key) => typeof key === "string")
      : [],
  };

  const result = await applyClientSheet(text, cleaned, new Date().toISOString());
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/companies", "layout");
  revalidatePath("/settings/clients");

  return { ok: true, data: result.applied };
}
