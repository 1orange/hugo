"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function E2eSignInForm() {
  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const email = new FormData(form).get("email");
        await signIn("e2e-test", {
          email: typeof email === "string" ? email : "",
          callbackUrl: "/companies",
        });
      }}
    >
      <p className="text-xs text-muted-foreground">
        E2E test sign-in (disabled in production)
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          className="rounded-md border border-border px-3 py-2"
          name="email"
          type="email"
          required
          data-testid="e2e-email"
        />
      </label>
      <Button type="submit" variant="outline" data-testid="e2e-submit">
        E2E sign in
      </Button>
    </form>
  );
}

type SignInPageProps = {
  e2eTestAuthEnabled: boolean;
  error?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin:
    "Sign in failed. Your account is not on the allowlist or the credentials were invalid.",
  AccessDenied:
    "Access refused. Your Google account is not on the allowlist for this application.",
};

export function SignInForm({ e2eTestAuthEnabled, error }: SignInPageProps) {
  const errorMessage = error ? ERROR_MESSAGES[error] ?? "Sign in failed." : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use your Google account to access the reconciliation dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorMessage ? (
            <p
              className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
          <Button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/companies" })}
          >
            Continue with Google
          </Button>

          {e2eTestAuthEnabled ? (
            <E2eSignInForm />
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
