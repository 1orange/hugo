import { NextResponse } from "next/server";
import { isTestAuthEnabled } from "@/lib/auth/test-auth";
import { seedE2eDatabase } from "@/lib/e2e/seed-e2e";

/**
 * Test-only: restores the e2e seed before each Playwright test. Exists only
 * when E2E_TEST_AUTH is on, which isTestAuthEnabled refuses in production.
 */
export async function POST(): Promise<NextResponse> {
  if (!isTestAuthEnabled(process.env)) {
    return new NextResponse(null, { status: 404 });
  }
  await seedE2eDatabase();
  return NextResponse.json({ ok: true });
}
