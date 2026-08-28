import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { buildMonthView } from "@/lib/sweep/views";
import { getSettings } from "@/adapters/store/settings";
import { RefreshButton } from "../../refresh-button";
import { FolderRepairPanel } from "./folder-repair-panel";
import { MonthLifecyclePanel } from "./month-lifecycle-panel";

type MonthPageProps = {
  params: Promise<{ companyId: string; monthKey: string }>;
};

export default async function MonthPage({ params }: MonthPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { companyId, monthKey } = await params;
  const companyIdNum = Number(companyId);
  if (!Number.isInteger(companyIdNum)) {
    notFound();
  }

  const view = buildMonthView(companyIdNum, monthKey);
  if (!view) {
    notFound();
  }

  const settings = getSettings();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href="/companies">
              Companies
            </Link>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {view.companyName}
          </h1>
          <p className="text-sm text-muted-foreground">Month {view.monthKey}</p>
        </div>
        <RefreshButton lastSweepAt={settings.lastSweepAt} />
      </header>

      <MonthLifecyclePanel
        companyId={companyIdNum}
        monthKey={monthKey}
        readOnly={view.readOnly}
        isOpenMonth={view.isOpenMonth}
      />

      <div className="grid gap-6">
        {view.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents in this month.</p>
        ) : (
          view.groups.map((group) => (
            <section
              key={group.driveFolderId}
              className="rounded-lg border border-border p-4"
              data-testid={`folder-group-${group.kind}`}
            >
              <h2 className="mb-3 text-lg font-medium">{group.title}</h2>
              {group.kind === "vat-output" ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  Omega VAT outputs at month root — read-only, never processed as
                  input documents.
                </p>
              ) : null}
              {view.readOnly ? null : group.kind === "repair-candidate" ||
              group.kind === "unknown" ||
              (group.kind === "canonical" && group.activeMutationId) ? (
                <FolderRepairPanel
                  companyId={companyIdNum}
                  monthKey={monthKey}
                  driveFolderId={group.driveFolderId}
                  observedName={group.observedName}
                  proposedTargetName={group.proposedTargetName}
                  kind={group.kind}
                  canRename={group.canRename}
                  renameBlockedReason={group.renameBlockedReason}
                  activeMutationId={group.activeMutationId}
                  canonicalFolderNames={view.canonicalFolderNames}
                />
              ) : null}
              {group.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents.</p>
              ) : (
                <ul className="space-y-2">
                  {group.documents.map((document) => (
                    <li
                      key={document.driveFileId}
                      className="text-sm"
                      data-testid="month-document"
                    >
                      {document.name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </main>
  );
}
