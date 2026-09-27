"use client";

import { signIn } from "next-auth/react";

function E2eSignInForm() {
  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-4"
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
      <p className="text-xs text-ink-3">
        Testovacie prihlásenie E2E (vypnuté v produkcii)
      </p>
      <label className="flex flex-col gap-1 text-sm">
        E-mail
        <input
          className="rounded-md border border-line bg-surface-2 px-3 py-2"
          name="email"
          type="email"
          required
          data-testid="e2e-email"
        />
      </label>
      <button
        type="submit"
        data-testid="e2e-submit"
        className="rounded-md border border-line-2 bg-surface px-4 py-2 text-sm font-medium text-ink-2 hover:border-accent hover:text-accent"
      >
        Prihlásiť sa (E2E)
      </button>
    </form>
  );
}

type SignInPageProps = {
  e2eTestAuthEnabled: boolean;
  error?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin:
    "Prihlásenie zlyhalo. Tvoj účet nie je na zozname povolených alebo boli údaje neplatné.",
  AccessDenied:
    "Prístup odmietnutý. Tvoj účet Google nie je na zozname povolených pre túto aplikáciu.",
};

export function SignInForm({ e2eTestAuthEnabled, error }: SignInPageProps) {
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? "Prihlásenie zlyhalo.")
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(16,21,25,0.06),0_14px_34px_-18px_rgba(16,21,25,0.34)]">
        <p className="text-[22px] font-bold tracking-[-0.03em]">
          hug<span className="text-accent">o</span>
        </p>
        <h1 className="mt-4 text-lg">Prihlásenie</h1>
        <p className="mt-1 text-sm text-ink-2">
          Prihlás sa účtom Google, ktorý má prístup k priečinkom klientov.
        </p>

        <div className="mt-5 flex flex-col gap-4">
          {errorMessage ? (
            <p
              className="rounded-md border-l-2 border-bad bg-bad-soft px-3 py-2 text-sm text-bad"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/companies" })}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110"
          >
            Pokračovať cez Google
          </button>

          {e2eTestAuthEnabled ? <E2eSignInForm /> : null}
        </div>
      </div>
    </main>
  );
}
