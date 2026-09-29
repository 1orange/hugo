import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { scheduleDocumentExtractionForMonth } from "@/lib/cash-discovery/schedule";
import { buildMonthView } from "@/lib/sweep/views";
import { buildMonthDocumentView } from "@/lib/documents/view";
import { getSettings } from "@/adapters/store/settings";
import { listMonthsForCompany } from "@/adapters/store/months";
import { monthLabel } from "@/modules/format-sk";
import { DocumentWorkbench } from "./document-workbench";
import { MonthRail } from "./month-rail";
import { OmegaExportPanel } from "./omega-export-panel";

type MonthPageProps = {
  params: Promise<{ companyId: string; monthKey: string }>;
  searchParams: Promise<{ folder?: string }>;
};

export default async function MonthPage({ params, searchParams }: MonthPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { companyId, monthKey } = await params;
  const { folder } = await searchParams;
  const companyIdNum = Number(companyId);
  if (!Number.isInteger(companyIdNum)) {
    notFound();
  }

  const view = await buildMonthView(companyIdNum, monthKey);
  const documentView = await buildMonthDocumentView(companyIdNum, monthKey, folder ?? null);
  if (!view || !documentView) {
    notFound();
  }

  if (!view.readOnly) {
    await scheduleDocumentExtractionForMonth(companyIdNum, monthKey);
  }

  const settings = await getSettings();
  const months = (await listMonthsForCompany(companyIdNum)).map((month) => ({
    monthKey: month.monthKey,
    closed: month.closedAt !== null,
  }));

  // Only folders that actually need a decision from her count as problems. A
  // folder the app already renamed is canonical now — a finished action whose
  // undo is still on offer — so it is listed separately and not counted.
  const repairGroups = view.groups.filter(
    (group) => group.kind === "repair-candidate" || group.kind === "unknown",
  );
  const repairedGroups = view.groups.filter(
    (group) => group.kind === "canonical" && group.activeMutationId !== null,
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:h-screen lg:overflow-hidden">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          {
            label: view.companyName,
            href: `/companies/${companyId}/activity`,
          },
          { label: monthKey, mono: true },
        ]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <MonthRail
        companyId={companyIdNum}
        monthKey={monthKey}
        months={months}
        awaitingCount={documentView.awaitingCount}
        decidedCount={documentView.decidedCount}
        totalCount={documentView.totalCount}
        pendingExtractionCount={documentView.pendingExtractionCount}
        readOnly={view.readOnly}
        isOpenMonth={view.isOpenMonth}
        missingSlots={view.missingSlots}
        repairGroups={repairGroups}
        repairedGroups={repairedGroups}
        canonicalFolderNames={view.canonicalFolderNames}
      />

      <DocumentWorkbench
        companyId={companyIdNum}
        monthKey={monthKey}
        view={documentView}
        autoAdvance={settings.autoAdvanceAfterDecision}
        basePath={`/companies/${companyId}/${monthKey}`}
      />

      <div className="shrink-0 border-t border-line px-3.5 py-3">
        <OmegaExportPanel companyId={companyIdNum} monthKey={monthKey} />
      </div>

      <p className="shrink-0 border-t border-line bg-surface-2 px-3.5 py-1.5 text-[11px] text-ink-3">
        <span className="sr-only">Klávesové skratky: </span>
        <b className="font-mono">C</b> potvrdiť · <b className="font-mono">N</b>{" "}
        nerelevantné · <b className="font-mono">J</b> /{" "}
        <b className="font-mono">K</b> ďalší a predchádzajúci doklad ·{" "}
        {monthLabel(monthKey)} ·{" "}
        <Link className="text-accent underline" href={`/companies/${companyId}/activity`}>
          Denník aktivity
        </Link>
      </p>
    </div>
  );
}
