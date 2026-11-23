import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { loadSettingsFormData } from "@/lib/settings/service";
import { listCompaniesAccess } from "@/adapters/store/company-access";
import { companyDisplayName } from "@/modules/company-display-name";
import { groupGrantsOf, visibleToAllowlist } from "@/modules/company-access";
import { formatSweepAge } from "@/modules/format-sk";
import { SettingsForm } from "./settings-form";
import { DriveAccessSection, type DriveAccessRow } from "./drive-access";

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
  const accessRows: DriveAccessRow[] = (await listCompaniesAccess()).map((company) => ({
    companyId: company.companyId,
    name: companyDisplayName(company.name),
    groupName: company.groupName,
    refreshedAt: company.refreshedAt,
    error: company.error,
    visibleTo: visibleToAllowlist(allowlist, company.principals),
    groups: groupGrantsOf(company.principals).map((group) => ({ email: group.email ?? "", role: group.role })),
  }));

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <AppBar
        crumbs={[{ label: "Firmy", href: "/companies" }, { label: "Nastavenia" }]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pt-6 sm:px-6">
        <Link href="/companies" className="text-[13.5px] font-medium text-accent hover:underline">
          ‹ Späť na zoznam firiem
        </Link>
        <header className="mt-2.5 mb-7">
          <h1 className="title-large">Nastavenia</h1>
          <p className="mt-1.5 text-[15px] text-ink-3">Platia pre všetkých v kancelárii.</p>
        </header>

        <SettingsForm
          initialDriveParentFolderId={settings.effectiveDriveParentFolderId ?? ""}
          initialCanonicalFolderNames={settings.canonicalFolderNames}
          initialMovableFolderNames={settings.movableFolderNames}
          initialAutoAdvanceAfterDecision={settings.autoAdvanceAfterDecision}
          lastSweepLabel={formatSweepAge(settings.lastSweepAt)}
        />

        <DriveAccessSection rows={accessRows} />
      </main>
    </div>
  );
}
