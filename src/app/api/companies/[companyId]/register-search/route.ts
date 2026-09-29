import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { searchCompanyRegister } from "@/lib/company-profile/service";

type RouteContext = {
  params: Promise<{ companyId: string }>;
};

/**
 * The profile form's search as she types. A route, not a server action:
 * Next runs a page's actions one at a time, so a 7 s RPO search held up the
 * lookup of the candidate she had already picked. A fetch can be cancelled.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.email || !isEmailAllowed(session.user.email, loadAllowlistFromEnv())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { companyId: companyIdRaw } = await context.params;
  const companyId = Number.parseInt(companyIdRaw, 10);
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const country = params.get("country") === "CZ" ? "CZ" : "SK";
  const result = await searchCompanyRegister(companyId, params.get("q") ?? "", country);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message });
  }
  return NextResponse.json({ ok: true, hits: result.hits, total: result.total });
}
