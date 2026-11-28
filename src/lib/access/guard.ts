/**
 * The session side of the visibility guard (./visibility.ts). Server actions and
 * API routes take the email from the session and refuse what it may not see;
 * pages do the same and answer with not-found.
 *
 * Kept apart from visibility.ts because this one reads the session: the rule
 * itself stays importable where there is no request.
 */
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { isCompanyVisible } from "./visibility";

/** The message an action answers with for a company the person may not see. Says nothing about whether it exists. */
export const COMPANY_NOT_VISIBLE_MESSAGE = "Firma neexistuje alebo k nej nemáš prístup.";

export type CompanyRefusal = { ok: false; message: string };

/** The signed-in email, when the allowlist still admits it; otherwise null. */
export async function sessionEmail(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  return email && isEmailAllowed(email, loadAllowlistFromEnv()) ? email : null;
}

/**
 * The refusal for an action on a company, or null when the email may act on it.
 * Takes the email so the rule can be tested without a session.
 */
export async function companyRefusalFor(email: string | null, companyId: number): Promise<CompanyRefusal | null> {
  if (email !== null && (await isCompanyVisible(email, companyId))) {
    return null;
  }
  return { ok: false, message: COMPANY_NOT_VISIBLE_MESSAGE };
}

/** For a server action that takes a company id: null to carry on, else the refusal to return. */
export async function companyActionRefusal(companyId: number): Promise<CompanyRefusal | null> {
  return companyRefusalFor(await sessionEmail(), companyId);
}
