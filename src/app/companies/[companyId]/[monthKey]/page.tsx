import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { scheduleDocumentExtractionForMonth } from "@/lib/cash-discovery/schedule";
import { raiseMonthForReading } from "@/lib/extraction-queue/raise-month";
import { scheduleSubjectChecksForMonth } from "@/lib/subject-directory/schedule";
import { isCompanyVisible } from "@/lib/access/visibility";
import { buildMonthView } from "@/lib/sweep/views";
import { buildMonthDocumentView } from "@/lib/documents/view";
import { getSettings } from "@/adapters/store/settings";
import { listMonthsForCompany } from "@/adapters/store/months";
import { monthLabel } from "@/modules/format-sk";
import { isFutureMonth, monthKeyAt } from "@/modules/month-lifecycle";
import { DocumentWorkbench } from "./document-workbench";
import { MonthRail } from "./month-rail";
import { LateArrivalsPanel } from "./late-arrivals-panel";
import { loadLateArrivalsView } from "@/lib/late-arrivals/service";
import { OmegaExportPanel } from "./omega-export-panel";
import { documentSortQuery, parseDocumentSortParams } from "@/modules/document-browser";

type MonthPageProps = {
  params: Promise<{ companyId: string; monthKey: string }>;
  searchParams: Promise<{ folder?: string; sort?: string; direction?: string; dir?: string }>;
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
  const { folder, sort, direction, dir } = await searchParams;
  const documentSort = parseDocumentSortParams({ sort, direction, dir });
  const companyIdNum = Number(companyId);
  if (!Number.isInteger(companyIdNum)) {
    notFound();
  }
  // A company the person's Drive sharing does not reach does not exist for them (ADR 0023).
  if (!(await isCompanyVisible(session.user.email, companyIdNum))) {
    notFound();
  }

  const view = await buildMonthView(companyIdNum, monthKey);
  const documentView = await buildMonthDocumentView(
    companyIdNum,
    monthKey,
    folder ?? null,
    documentSort,
  );
  if (!view || !documentView) {
    notFound();
  }

  // Queued after the page is sent: the month's unread documents, and the party
  // checks of documents first looked at now (ADR 0022), closed months too.
  // The month is raised after its unread documents are queued, so the ones found
  // just now move ahead with the rest. Raising never fails the page.
  after(async () => {
    if (!view.readOnly) {
      await scheduleDocumentExtractionForMonth(companyIdNum, monthKey);
    }
    await raiseMonthForReading(companyIdNum, monthKey);
    await scheduleSubjectChecksForMonth(companyIdNum, monthKey);
  });

  const settings = await getSettings();
  const lateArrivals = await loadLateArrivalsView(companyIdNum);
  // Pre-created months that have not started yet are not offered in the rail.
  const currentMonthKey = monthKeyAt(new Date());
  const months = (await listMonthsForCompany(companyIdNum))
    .filter((month) => !isFutureMonth(month.monthKey, currentMonthKey))
    .map((month) => ({
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

  const basePath = `/companies/${companyId}/${monthKey}`;

  return (
    <div className="relative flex min-h-screen flex-col bg-ground lg:h-screen lg:overflow-hidden">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          {
            label: view.companyName,
            href: `/companies/${companyId}/activity`,
          },
          { label: monthLabel(monthKey) },
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
        futureUploads={view.futureUploads}
        repairGroups={repairGroups}
        repairedGroups={repairedGroups}
        canonicalFolderNames={view.canonicalFolderNames}
        exportControl={
          <OmegaExportPanel
            companyId={companyIdNum}
            monthKey={monthKey}
            integrityProblems={documentView.subjectProblems.map((problem) => ({
              documentId: problem.id,
              label: problem.label,
              fileName: problem.name,
              href: `${basePath}?${documentSortQuery(documentView.sortKey, documentView.sortDirection)}&doc=${encodeURIComponent(problem.id)}`,
            }))}
          />
        }
      />

      <LateArrivalsPanel
        companyId={companyIdNum}
        monthKey={monthKey}
        isOpenMonth={view.isOpenMonth}
        view={lateArrivals}
      />

      <DocumentWorkbench
        companyId={companyIdNum}
        monthKey={monthKey}
        view={documentView}
        autoAdvance={settings.autoAdvanceAfterDecision}
        basePath={basePath}
      />

    </div>
  );
}
