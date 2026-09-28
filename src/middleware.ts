import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";

const PUBLIC_PATHS = new Set([
  "/sign-in",
  "/auth/refused",
  "/auth/error",
  "/api/auth",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  // Playwright resets the e2e database before signing in; the route itself
  // also refuses to exist without the flag.
  if (
    pathname === "/api/e2e/reset" &&
    process.env.E2E_TEST_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return true;
  }

  return pathname.startsWith("/api/auth/");
}

export default auth((request: NextRequest & { auth: unknown }) => {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = request.auth as {
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  let allowlist: string[];
  try {
    allowlist = loadAllowlistFromEnv();
  } catch {
    return new NextResponse("Server misconfigured: ALLOWED_EMAILS missing", {
      status: 500,
    });
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    return NextResponse.redirect(new URL("/auth/refused", request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
