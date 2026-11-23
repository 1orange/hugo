"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { CompanyListItem } from "@/lib/sweep/views";
import { companyGroupKey, companyGroupsOf, filterByGroup, parseCompanyGroup } from "@/modules/company-groups";
import {
  chaseActionLabel,
  chaseIsQuiet,
  chaseSeverity,
  matchesChaseFilter,
  summariseChaseList,
  type ChaseFilter,
  type ChaseSeverity,
} from "@/modules/chase-list";
import { profileMissingLabel, profileSetupActionLabel } from "@/modules/company-profile";
import { registerStatusLabelOf } from "@/modules/subject-screen";
import { structureBadgeLabel } from "@/modules/drive-structure";
import {
  formatDate,
  formatUploadMoment,
  monthLabel,
  pluralSk,
} from "@/modules/format-sk";

const NEXT_STEP_INK: Record<ChaseSeverity, string> = {
  critical: "text-bad",
  warning: "text-warn",
  active: "text-accent",
  done: "text-good",
  none: "text-ink-3",
};

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${className}`} />;
}

function StatementCell({ arrivedAt }: { arrivedAt: string | null }) {
  if (!arrivedAt) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-medium text-bad">
        <Dot className="bg-bad-dot" />
        Žiadny výpis
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-good">
      <Dot className="bg-good-dot" />
      Doručený {formatDate(arrivedAt)}
    </span>
  );
}

function Figure({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="tabular text-[14px] text-ink-4">—</span>;
  }
  return (
    <span className={`tabular text-[14px] ${value === 0 ? "text-ink-4" : "font-semibold text-ink"}`}>
      {value}
    </span>
  );
}

/** A summary figure that filters the table to what it counts. */
function SummaryToken({
  count,
  label,
  tone,
  testId,
  active,
  onToggle,
}: {
  count: number;
  label: string;
  tone: "accent" | "bad" | "warn" | "good";
  testId: string;
  active: boolean;
  onToggle: () => void;
}) {
  const zero = count === 0;
  const ink = { accent: "text-accent", bad: "text-bad", warn: "text-warn", good: "text-good" }[tone];
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={zero && !active}
      onClick={onToggle}
      className={`press inline-flex items-baseline gap-2 rounded-full px-3.5 py-2 text-[13.5px] ${
        active
          ? "bg-ink text-white shadow-[0_1px_2px_rgb(0_0_0/0.2)]"
          : zero
            ? "text-ink-3 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]"
            : "bg-surface text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_1px_2px_rgb(0_0_0/0.04)] hover:bg-surface-2"
      }`}
    >
      <span
        data-testid={testId}
        className={`tabular text-[15px] font-bold ${active ? "text-white" : zero ? "text-ink-3" : ink}`}
      >
        {count}
      </span>
      <span>{label}</span>
    </button>
  );
}

/**
 * The accountant group choice is kept in this browser. Reads are wrapped because
 * blocked or throwing storage must not break the page: the choice then holds
 * until the page is left.
 */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function ScopeButton({
  label,
  pressed,
  testId,
  onClick,
}: {
  label: string;
  pressed: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className="segment"
    >
      {label}
    </button>
  );
}

type CompanyTableProps = {
  /** The companies the person may see, already in chase order (ADR 0023). */
  rows: CompanyListItem[];
  /** The signed-in email; the group choice is kept under a key for it. */
  email: string;
  selectedMonth: string | null;
  /** The month picker, shown beside the group chips. */
  monthControl?: ReactNode;
};

/**
 * The *Firmy* summary strip and table. Server work has already happened: `rows`
 * are only the companies this person may see, so the figures count theirs and
 * nothing else. This decides only the accountant-group narrowing.
 */
export function CompanyTable({ rows, email, selectedMonth, monthControl }: CompanyTableProps) {
  // The accountant's group ("Eva", "Katarína"), when the drive keeps clients per accountant.
  const groups = useMemo(() => companyGroupsOf(rows), [rows]);
  const groupKey = useMemo(() => companyGroupKey(email), [email]);
  const [storedGroup, setStoredGroup] = useState<string | null>(null);
  useEffect(() => {
    setStoredGroup(parseCompanyGroup(readStorage(groupKey), groups));
  }, [groupKey, groups]);

  // The chips show only when the visible companies span more than one group. Then a
  // stored choice cannot narrow the table with no chip left to undo it.
  const showGroups = groups.length > 1;
  const group = showGroups ? storedGroup : null;

  function chooseGroup(next: string | null) {
    setStoredGroup(next);
    try {
      if (next === null) {
        window.localStorage.removeItem(groupKey);
      } else {
        window.localStorage.setItem(groupKey, next);
      }
    } catch {
      // Blocked storage: the choice holds until the page is left.
    }
  }

  const scoped = useMemo(() => filterByGroup(rows, group), [rows, group]);
  const summary = useMemo(() => summariseChaseList(scoped), [scoped]);
  // A figure she clicked narrows the table; the figures keep counting everything shown.
  const [filter, setFilter] = useState<ChaseFilter | null>(null);
  const visible = useMemo(
    () => (filter ? scoped.filter((company) => matchesChaseFilter(company, filter)) : scoped),
    [scoped, filter],
  );
  const shownMonths = useMemo(
    () =>
      [
        ...new Set(
          scoped
            .map((company) => company.monthKey)
            .filter((key): key is string => key !== null),
        ),
      ].sort(),
    [scoped],
  );

  const tokens: Array<{ filter: ChaseFilter; count: number; label: string; tone: "accent" | "bad" | "warn" | "good"; testId: string }> = [
    {
      filter: "awaiting",
      count: summary.awaitingTotal,
      label: `${pluralSk(summary.awaitingTotal, ["doklad čaká", "doklady čakajú", "dokladov čaká"])} na rozhodnutie`,
      tone: "accent",
      testId: "summary-awaiting",
    },
    { filter: "without-statement", count: summary.withoutStatement, label: "bez bankového výpisu", tone: "bad", testId: "summary-without-statement" },
    { filter: "silent", count: summary.silent, label: "celý mesiac nič nenahrali", tone: "bad", testId: "summary-silent" },
    { filter: "profile-missing", count: summary.withoutProfile, label: "bez profilu firmy", tone: "warn", testId: "summary-profile-missing" },
    { filter: "structure", count: summary.withStructureDeviations, label: "s odchýlkami priečinkov", tone: "warn", testId: "summary-structure-deviations" },
    { filter: "ready-to-close", count: summary.readyToClose, label: "pripravené na uzavretie", tone: "good", testId: "summary-ready-to-close" },
  ];

  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-4 pt-6 pb-16 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="title-large">Firmy</h1>
          <p className="mt-1.5 text-[15px] text-ink-3">
            {selectedMonth ? "Vybraný mesiac" : shownMonths.length === 1 ? "Otvorený mesiac" : "Otvorené mesiace"}{" "}
            <strong className="font-semibold text-ink">
              {selectedMonth ? monthLabel(selectedMonth) : shownMonths.map((key) => monthLabel(key)).join(" · ") || "—"}
            </strong>
            {" · "}
            {visible.length} z {rows.length} {pluralSk(rows.length, ["firmy", "firiem", "firiem"])}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5" data-testid="company-scope">
          {monthControl}
          {showGroups ? (
            <div role="group" aria-label="Účtovníčka" className="segmented" data-testid="company-groups">
              <ScopeButton
                label="Všetky skupiny"
                pressed={group === null}
                testId="group-all"
                onClick={() => chooseGroup(null)}
              />
              {groups.map((name) => (
                <ScopeButton
                  key={name}
                  label={name}
                  pressed={group === name}
                  testId={`group-${name}`}
                  onClick={() => chooseGroup(name)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <section aria-label="Súhrn" data-testid="company-summary" className="mb-5 flex flex-wrap items-center gap-2">
        {tokens.map((token) => (
          <SummaryToken
            key={token.filter}
            count={token.count}
            label={token.label}
            tone={token.tone}
            testId={token.testId}
            active={filter === token.filter}
            onToggle={() => setFilter(filter === token.filter ? null : token.filter)}
          />
        ))}
        {filter ? (
          <button
            type="button"
            onClick={() => setFilter(null)}
            className="press rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-accent hover:bg-fill"
          >
            Zrušiť filter
          </button>
        ) : null}
      </section>

      <div className="inset-group overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[14px]">
          <caption className="sr-only">Firmy s prehľadom doručených dokladov za otvorený mesiac</caption>
          <thead>
            <tr className="text-[12px] font-medium text-ink-3">
              <th scope="col" className="border-b border-line px-2 py-2.5 text-left font-medium">Firma</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-left font-medium">Bankový výpis</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-right font-medium">Doručené</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-right font-medium">Čaká</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 pl-6 text-left font-medium">Posledné nahratie</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 text-left font-medium">Ďalší krok</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((company) => {
              const severity = chaseSeverity(company.chaseState);
              const href = company.monthKey
                ? `/companies/${company.id}/${company.monthKey}`
                : company.openMonth
                  ? `/companies/${company.id}/${company.openMonth}`
                  : `/companies/${company.id}/activity`;
              const quiet = chaseIsQuiet(company.chaseState);

              return (
                <tr key={company.id} className="group transition-colors duration-100 hover:bg-surface-2">
                  <td className="border-b border-line px-2 py-2.5 align-middle">
                    <Link
                      href={href}
                      data-testid={`company-${company.id}`}
                      className={`text-[15px] font-semibold tracking-[-0.01em] hover:text-accent ${quiet ? "text-ink-3" : "text-ink"}`}
                    >
                      {company.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-ink-3">
                      {company.groupName && group === null ? (
                        <span data-testid={`company-group-${company.id}`}>{company.groupName}</span>
                      ) : null}
                      {company.profileMissing ? (
                        <Link
                          href={`/companies/${company.id}/profile`}
                          data-testid={`company-profile-missing-${company.id}`}
                          className="inline-flex items-center gap-1.5 text-warn hover:underline"
                        >
                          <Dot className="size-1.5 bg-warn-dot" />
                          {profileMissingLabel()}
                        </Link>
                      ) : null}
                      {company.structureDeviations > 0 ? (
                        <Link
                          href={`/companies/${company.id}/structure`}
                          data-testid={`company-structure-${company.id}`}
                          className="inline-flex items-center gap-1.5 text-warn hover:underline"
                        >
                          <Dot className="size-1.5 bg-warn-dot" />
                          {structureBadgeLabel(company.structureDeviations)}
                        </Link>
                      ) : null}
                      {company.registerStanding ? (
                        <Link
                          href={`/companies/${company.id}/profile`}
                          data-testid={`company-register-${company.id}`}
                          className="inline-flex items-center gap-1.5 text-ink-3 hover:text-ink-2"
                        >
                          <Dot className="size-1.5 bg-bad-dot" />
                          Klient {registerStatusLabelOf(company.registerStanding)} v registri
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td className="border-b border-line px-3 py-2.5 align-middle">
                    {company.monthKey && !company.monthClosed ? (
                      <StatementCell arrivedAt={company.statementArrivedAt} />
                    ) : company.monthKey ? (
                      <span className="text-[13px] text-ink-3">
                        {company.statementArrivedAt ? "Doručený" : "Žiadny výpis"}
                      </span>
                    ) : (
                      <span className="text-[13px] text-ink-4">—</span>
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
                  <td className="border-b border-line px-3 py-2.5 pl-6 align-middle text-[13px]">
                    {company.monthKey && !company.monthClosed && !company.lastUploadAt ? (
                      <span className="text-bad">Tento mesiac nič</span>
                    ) : (
                      <span className="tabular text-ink-3">
                        {company.monthKey ? formatUploadMoment(company.lastUploadAt) : "—"}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <span
                          data-testid={`company-stage-${company.id}`}
                          className={`text-[13.5px] whitespace-nowrap ${quiet ? "text-ink-3" : NEXT_STEP_INK[severity]} ${
                            company.chaseState === "ready-to-close" ? "font-semibold" : ""
                          }`}
                        >
                          {chaseActionLabel(company.chaseState, company.awaitingCount)}
                        </span>
                        <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-3">
                          {company.profileMissing ? (
                            <Link
                              href={`/companies/${company.id}/profile`}
                              data-testid={`company-profile-setup-${company.id}`}
                              className="font-medium text-accent hover:underline"
                            >
                              {profileSetupActionLabel()}
                            </Link>
                          ) : null}
                          {company.monthKey ? <span>{monthLabel(company.monthKey)}</span> : null}
                        </div>
                      </div>
                      <Link href={href} aria-hidden tabIndex={-1} className="text-ink-4 group-hover:text-ink-3">
                        <ChevronRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[15px] font-semibold">Nič tu nečaká</p>
            <p className="mt-1 text-ink-3">
              Tomuto filtru nezodpovedá žiadna firma.{" "}
              <button type="button" onClick={() => setFilter(null)} className="font-medium text-accent hover:underline">
                Zobraziť všetky
              </button>
            </p>
          </div>
        ) : null}
      </div>

      <p className="mx-1 mt-3.5 text-[12.5px] text-ink-3">
        Zobrazuje sa len to, čo naozaj prišlo — žiadne očakávané počty a žiadne automatické upomienky. Klientov
        urguješ vlastnými slovami.
      </p>
    </main>
  );
}
