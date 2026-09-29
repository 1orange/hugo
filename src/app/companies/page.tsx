import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { LiveRefresh } from "@/components/app/live-refresh";
import { ensureFreshSweep } from "@/lib/sweep/ensure-fresh-sweep";
import {
  listAllMonthKeys,
  listCompanySummaries,
  summariseChaseList,
} from "@/lib/sweep/views";
import { getSettings } from "@/adapters/store/settings";
import { scheduleDocumentExtractionForMonth } from "@/lib/cash-discovery/schedule";
import {
  chaseActionLabel,
  chaseIsQuiet,
  chaseSeverity,
  type ChaseSeverity,
} from "@/modules/chase-list";
import { profileMissingLabel, profileSetupActionLabel } from "@/modules/company-profile";
import { ChaseMonthPicker } from "./chase-month-picker";
import {
  formatDate,
  formatUploadMoment,
  monthLabel,
  pluralSk,
} from "@/modules/format-sk";

const STRIPE: Record<ChaseSeverity, string> = {
  critical: "bg-bad",
  warning: "bg-warn",
  active: "bg-accent",
  done: "bg-good",
  none: "bg-transparent",
};

function StatementCell({ arrivedAt }: { arrivedAt: string | null }) {
  if (!arrivedAt) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-bad-soft px-2.5 py-[3px] text-[11.5px] font-medium text-bad">
        Žiadny výpis
      </span>
    );
  }
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-good-soft px-2.5 py-[3px] text-[11.5px] font-medium text-good">
      Doručený {formatDate(arrivedAt)}
    </span>
  );
}

function Figure({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="font-mono text-[15px] text-ink-3">—</span>;
  }
  return (
    <span
      className={`font-mono text-[15px] font-medium ${value === 0 ? "text-ink-3" : "text-ink"}`}
    >
      {value}
    </span>
  );
}

type CompaniesPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  await ensureFreshSweep();

  const { month } = await searchParams;
  const monthKeys = await listAllMonthKeys();
  const selectedMonth = month && monthKeys.includes(month) ? month : null;

  const companies = await listCompanySummaries(selectedMonth);
  const summary = summariseChaseList(companies);
  const settings = await getSettings();

  // Warm the parsers here rather than waiting for her to open a month: by the
  // time she clicks into a client, the eKasa receipts that arrived since the
  // last visit are usually already read. Already-attempted files are skipped,
  // so a repeat visit costs nothing.
  for (const company of companies) {
    if (company.openMonth && !company.monthClosed) {
      await scheduleDocumentExtractionForMonth(company.id, company.openMonth);
    }
  }

  const shownMonths = [
    ...new Set(
      companies
        .map((company) => company.monthKey)
        .filter((key): key is string => key !== null),
    ),
  ].sort();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <LiveRefresh />
      <AppBar
        crumbs={
          selectedMonth
            ? [{ label: "Firmy", href: "/companies" }, { label: selectedMonth, mono: true }]
            : [{ label: "Firmy" }]
        }
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <ChaseMonthPicker monthKeys={monthKeys} selected={selectedMonth} />

      {companies.length === 0 ? (
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md rounded-lg border border-line bg-surface-2 p-6">
            <h1 className="text-lg">Zatiaľ žiadne firmy</h1>
            <p className="mt-2 text-sm text-ink-2">
              Nastav prístup k Drive a spusti načítanie, aby sa priečinky klientov
              našli.
            </p>
            <p className="mt-3 text-sm text-ink-3">
              Vyplň nadradený priečinok Drive v{" "}
              <Link className="text-accent underline" href="/settings">
                Nastaveniach
              </Link>{" "}
              a stlač Obnoviť.
            </p>
          </div>
        </main>
      ) : (
        <main className="flex flex-1 flex-col">
          <section
            aria-label="Súhrn"
            className="flex flex-wrap border-b border-line bg-surface"
          >
            <div className="flex flex-col gap-0.5 px-[18px] py-3.5">
              <span className="font-mono text-[23px] font-medium tracking-[-0.02em]">
                {summary.awaitingTotal}
              </span>
              <span className="text-[11.5px] text-ink-3">
                {pluralSk(summary.awaitingTotal, [
                  "doklad čaká",
                  "doklady čakajú",
                  "dokladov čaká",
                ])}{" "}
                na rozhodnutie
              </span>
            </div>
            <div className="flex flex-col gap-0.5 border-l border-line px-[18px] py-3.5">
              <span
                className={`font-mono text-[23px] font-medium tracking-[-0.02em] ${
                  summary.withoutStatement > 0 ? "text-bad" : ""
                }`}
              >
                {summary.withoutStatement}
              </span>
              <span className="text-[11.5px] text-ink-3">bez bankového výpisu</span>
            </div>
            <div className="flex flex-col gap-0.5 border-l border-line px-[18px] py-3.5">
              <span
                className={`font-mono text-[23px] font-medium tracking-[-0.02em] ${
                  summary.silent > 0 ? "text-bad" : ""
                }`}
              >
                {summary.silent}
              </span>
              <span className="text-[11.5px] text-ink-3">
                celý mesiac nič nenahralo
              </span>
            </div>
            <div className="flex flex-col gap-0.5 border-l border-line px-[18px] py-3.5">
              <span className="font-mono text-[23px] font-medium tracking-[-0.02em]">
                {summary.readyToClose}
              </span>
              <span className="text-[11.5px] text-ink-3">pripravené na uzavretie</span>
            </div>
            <div className="flex flex-col gap-0.5 border-l border-line px-[18px] py-3.5">
              <span
                className={`font-mono text-[23px] font-medium tracking-[-0.02em] ${
                  summary.withoutProfile > 0 ? "text-warn" : ""
                }`}
              >
                {summary.withoutProfile}
              </span>
              <span className="text-[11.5px] text-ink-3">bez profilu firmy</span>
            </div>
            {shownMonths.length > 0 ? (
              <div className="ml-auto flex flex-col justify-center gap-0.5 px-[18px] py-3.5 text-right">
                <span className="text-[11.5px] text-ink-3">
                  {selectedMonth
                    ? "Vybraný mesiac"
                    : shownMonths.length === 1
                      ? "Otvorený mesiac"
                      : "Otvorené mesiace"}
                </span>
                <span className="font-mono text-[16px] font-medium">
                  {selectedMonth ?? shownMonths.join(" · ")}
                </span>
              </div>
            ) : null}
          </section>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] max-w-[1280px] border-collapse text-[13px]">
              <caption className="sr-only">
                Firmy s prehľadom doručených dokladov za otvorený mesiac
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface-2 px-3 py-2.5 text-left text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.12em] text-ink-3"
                  >
                    Firma
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface-2 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Bankový výpis
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface-2 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Doručené
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface-2 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Čaká
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface-2 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Posledné nahratie
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface-2 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Ďalší krok
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const severity = chaseSeverity(company.chaseState);
                  const href = company.monthKey
                    ? `/companies/${company.id}/${company.monthKey}`
                    : company.openMonth
                      ? `/companies/${company.id}/${company.openMonth}`
                      : `/companies/${company.id}/activity`;
                  const quiet = chaseIsQuiet(company.chaseState);

                  return (
                    <tr key={company.id} className="group hover:bg-surface-2">
                      <td className="border-b border-line px-3 py-2.5 align-middle whitespace-nowrap">
                        <span className="flex items-center gap-2.5">
                          <i
                            aria-hidden
                            className={`h-[26px] w-[3px] shrink-0 rounded-full ${STRIPE[severity]}`}
                          />
                          <Link
                            href={href}
                            data-testid={`company-${company.id}`}
                            className={`font-semibold hover:text-accent ${
                              quiet ? "text-ink-3" : ""
                            }`}
                          >
                            {company.name}
                          </Link>
                          {company.profileMissing ? (
                            <Link
                              href={`/companies/${company.id}/profile`}
                              data-testid={`company-profile-missing-${company.id}`}
                              className="inline-flex items-center rounded-full bg-warn-soft px-2 py-[2px] text-[10.5px] font-medium text-warn hover:underline"
                            >
                              {profileMissingLabel()}
                            </Link>
                          ) : null}
                        </span>
                      </td>
                      <td className="border-b border-line px-3 py-2.5 align-middle">
                        {company.monthKey && !company.monthClosed ? (
                          <StatementCell arrivedAt={company.statementArrivedAt} />
                        ) : company.monthKey ? (
                          <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-[3px] text-[11.5px] text-ink-3">
                            {company.statementArrivedAt ? "Doručený" : "Žiadny výpis"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-[3px] text-[11.5px] text-ink-3">
                            —
                          </span>
                        )}
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-right align-middle">
                        <Figure value={company.monthKey ? company.proofsArrived : null} />
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-right align-middle">
                        <span data-testid={`company-awaiting-${company.id}`}>
                          <Figure value={company.awaitingCount} />
                        </span>
                      </td>
                      <td className="border-b border-line px-3 py-2.5 align-middle">
                        {company.monthKey &&
                        !company.monthClosed &&
                        !company.lastUploadAt ? (
                          <span className="text-bad">Tento mesiac nič</span>
                        ) : (
                          <span className={quiet ? "text-ink-3" : "text-ink-2"}>
                            {company.monthKey
                              ? formatUploadMoment(company.lastUploadAt)
                              : "—"}
                          </span>
                        )}
                      </td>
                      <td className="border-b border-line px-3 py-2.5 align-middle">
                        <span
                          data-testid={`company-stage-${company.id}`}
                          style={{ whiteSpace: "nowrap" }}
                          className={
                            company.chaseState === "ready-to-close"
                              ? "inline-flex items-center rounded-full bg-good-soft px-2.5 py-[3px] text-[11.5px] font-medium text-good"
                              : quiet
                                ? "text-ink-3"
                                : "text-ink-2"
                          }
                        >
                          {chaseActionLabel(company.chaseState, company.awaitingCount)}
                        </span>
                        {company.profileMissing ? (
                          <Link
                            href={`/companies/${company.id}/profile`}
                            data-testid={`company-profile-setup-${company.id}`}
                            className="ml-2 text-[11.5px] text-accent underline"
                          >
                            {profileSetupActionLabel()}
                          </Link>
                        ) : null}
                        {company.monthKey ? (
                          <span className="ml-2 text-[11px] text-ink-3">
                            {monthLabel(company.monthKey)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="px-3.5 py-3 text-[11.5px] text-ink-3">
            Zobrazuje sa len to, čo naozaj prišlo — žiadne očakávané počty a žiadne
            automatické upomienky. Klientov urguješ vlastnými slovami.
          </p>
        </main>
      )}
    </div>
  );
}
