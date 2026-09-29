import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { loadSettingsFormData } from "@/lib/settings/service";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const settings = await loadSettingsFormData();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[{ label: "Firmy", href: "/companies" }, { label: "Nastavenia" }]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl">Nastavenia</h1>
            <p className="mt-1 text-sm text-ink-2">
              Názvy priečinkov, prístup k Drive a spôsob práce s dokladmi.
            </p>
          </div>
          <Link
            className="shrink-0 rounded-md border border-line-2 bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 hover:border-accent hover:text-accent"
            href="/activity"
          >
            Celý denník aktivity
          </Link>
        </header>

        <div className="mt-6">
          <SettingsForm
            initialDriveParentFolderId={settings.effectiveDriveParentFolderId ?? ""}
            initialCanonicalFolderNames={settings.canonicalFolderNames}
            initialMovableFolderNames={settings.movableFolderNames}
            initialAutoAdvanceAfterDecision={settings.autoAdvanceAfterDecision}
          />
        </div>
      </main>
    </div>
  );
}
