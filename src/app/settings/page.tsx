import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
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

  const settings = loadSettingsFormData();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Global folder taxonomy and Drive configuration.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
            href="/activity"
          >
            All activity
          </Link>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
            href="/companies"
          >
            Back to companies
          </Link>
        </div>
      </header>

      <SettingsForm
        initialDriveParentFolderId={settings.effectiveDriveParentFolderId ?? ""}
        initialCanonicalFolderNames={settings.canonicalFolderNames}
        initialMovableFolderNames={settings.movableFolderNames}
      />
    </main>
  );
}
