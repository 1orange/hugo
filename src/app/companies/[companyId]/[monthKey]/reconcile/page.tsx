import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { scheduleCashDiscoveryForMonth } from "@/lib/cash-discovery/schedule";
import {
  buildReconciliationView,
  listProofFolderFilters,
} from "@/lib/reconciliation/view";
import { getSettings } from "@/adapters/store/settings";
import { RefreshButton } from "../../../refresh-button";
import { MonthLifecyclePanel } from "../month-lifecycle-panel";
import { ReconciliationPanel } from "./reconciliation-panel";

type ReconcilePageProps = {
  params: Promise<{ companyId: string; monthKey: string }>;
};

export default async function ReconcilePage({ params }: ReconcilePageProps) {
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

  const view = buildReconciliationView(companyIdNum, monthKey);
  if (!view) {
    notFound();
  }

  if (!view.readOnly) {
    scheduleCashDiscoveryForMonth(companyIdNum, monthKey);
  }

  const settings = getSettings();
  const folderFilters = listProofFolderFilters(companyIdNum, monthKey);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href="/companies">
              Companies
            </Link>
            {" · "}
            <Link className="underline" href={`/companies/${companyId}/${monthKey}`}>
              Month overview
            </Link>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {view.companyName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Reconciliation · {view.monthKey}
            {" · "}
            <Link className="underline" href={`/companies/${companyId}/activity`}>
              Activity log
            </Link>
          </p>
        </div>
        <RefreshButton lastSweepAt={settings.lastSweepAt} />
      </header>

      <MonthLifecyclePanel
        companyId={companyIdNum}
        monthKey={monthKey}
        readOnly={view.readOnly}
        isOpenMonth={view.isOpenMonth}
      />

      <ReconciliationPanel
        companyId={companyIdNum}
        monthKey={monthKey}
        view={view}
        folderFilters={folderFilters}
      />
    </main>
  );
}
