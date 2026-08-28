import NextAuth from "next-auth";
import type { Session } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import {
  isEmailAllowed,
  loadAllowlistFromEnv,
} from "@/lib/auth/allowlist";
import { isTestAuthEnabled } from "@/lib/auth/test-auth";

function getAllowlist(): string[] {
  return loadAllowlistFromEnv();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    ...(isTestAuthEnabled()
      ? [
          Credentials({
            id: "e2e-test",
            name: "E2E Test",
            credentials: {
              email: { label: "Email", type: "email" },
            },
            authorize(credentials) {
              const email =
                typeof credentials?.email === "string"
                  ? credentials.email
                  : null;
              if (!email || !isEmailAllowed(email, getAllowlist())) {
                return null;
              }

              return {
                id: email,
                email,
                name: "E2E Test User",
              };
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/sign-in",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    signIn({ user }) {
      return isEmailAllowed(user.email, getAllowlist());
    },
    session({ session, token }) {
      const email =
        session.user?.email ?? (typeof token.email === "string" ? token.email : null);

      if (!isEmailAllowed(email, getAllowlist())) {
        return { ...session, user: undefined, expires: new Date(0).toISOString() };
      }

      if (session.user && email) {
        session.user.email = email;
      }

      return session;
    },
    jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }

      if (!isEmailAllowed(token.email, getAllowlist())) {
        return {};
      }

      return token;
    },
  },
  trustHost: true,
});

export function requireAllowedSession(
  session: Session | null,
): asserts session is Session & { user: { email: string } } {
  if (!session?.user?.email) {
    throw new Error("UNAUTHENTICATED");
  }

  if (!isEmailAllowed(session.user.email, getAllowlist())) {
    throw new Error("FORBIDDEN");
  }
}
