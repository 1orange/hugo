"use server";

import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import {
  lookupCompanyRegister,
  saveCompanyProfileForUser,
} from "@/lib/company-profile/service";
import type { CompanyCountry, RegisterLookup } from "@/modules/company-profile";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

function parseCountry(raw: string): CompanyCountry {
  return raw === "CZ" ? "CZ" : "SK";
}

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

export async function lookupRegisterAction(
  ico: string,
  countryRaw: string,
): Promise<
  ActionResult<{ lookup: RegisterLookup; registerSource: string; icDph: string | null; icDphNote: string | null }>
> {
  const denied = await assertAllowed();
  if (denied) {
    return denied;
  }

  const result = await lookupCompanyRegister(ico, parseCountry(countryRaw));
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return {
    ok: true,
    data: {
      lookup: result.lookup,
      registerSource: result.registerSource,
      icDph: result.icDph,
      icDphNote: result.icDphNote,
    },
  };
}

export async function saveCompanyProfileAction(
  companyId: number,
  input: {
    country: CompanyCountry;
    legalName: string;
    address: string;
    ico: string;
    dic: string;
    icDph: string;
    registerSource: string;
  },
): Promise<ActionResult<{ savedAt: string }>> {
  const denied = await assertAllowed();
  if (denied) {
    return denied;
  }

  const result = await saveCompanyProfileForUser(companyId, input, new Date().toISOString());
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}/profile`);

  return { ok: true, data: { savedAt: result.profile.savedAt } };
}

export async function saveCompanyProfileFormAction(
  companyId: number,
  formData: FormData,
): Promise<void> {
  const denied = await assertAllowed();
  if (denied) {
    redirect(`/companies/${companyId}/profile?error=${encodeURIComponent(denied.message)}`);
  }

  const country = parseCountry(String(formData.get("country") ?? "SK"));

  const result = await saveCompanyProfileForUser(
    companyId,
    {
      country,
      legalName: String(formData.get("legalName") ?? ""),
      address: String(formData.get("address") ?? ""),
      ico: String(formData.get("ico") ?? ""),
      dic: String(formData.get("dic") ?? ""),
      icDph: String(formData.get("icDph") ?? ""),
      registerSource: String(formData.get("registerSource") ?? ""),
    },
    new Date().toISOString(),
  );

  if (!result.ok) {
    redirect(`/companies/${companyId}/profile?error=${encodeURIComponent(result.message)}`);
  }

  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}/profile`);
  redirect(`/companies/${companyId}/profile?saved=1`);
}
