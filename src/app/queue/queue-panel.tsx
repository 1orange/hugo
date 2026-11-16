"use client";

import Link from "next/link";
import { Cpu, LoaderCircle } from "lucide-react";
import { useExtractionQueue } from "@/components/app/use-extraction-queue";
import type { FinishedJobView, ModelLimitSource, QueueJobView, QueueLane } from "@/lib/extraction-queue/types";
import type { ServiceHealth, ServiceState } from "@/lib/extraction-queue/service-health";
import type { ExtractionQueueView } from "@/lib/extraction-queue/view";
import { companyDisplayName } from "@/modules/company-display-name";
import { extractionFailureMessage } from "@/modules/extraction-failure";
import { formatElapsed } from "@/modules/extraction-progress";
import { countWithNoun, DOKLAD_FORMS, formatTime, monthLabel } from "@/modules/format-sk";
import {
  formatStageDuration,
  stageDetail,
  summarizeStages,
  TIMED_STAGE_LABEL,
  TIMED_STAGES,
  type StageTiming,
} from "@/modules/extraction-timing";

const STATE_CHIP: Record<ServiceState, { label: string; className: string; dot: string; icon: string }> = {
  ok: { label: "beží", className: "text-good", dot: "bg-good-dot", icon: "bg-good-soft text-good" },
  loading: { label: "načítava sa", className: "text-warn", dot: "bg-warn-dot", icon: "bg-warn-soft text-warn" },
  down: { label: "nedostupné", className: "text-bad", dot: "bg-bad-dot", icon: "bg-bad-soft text-bad" },
  unconfigured: { label: "nenastavené", className: "text-bad", dot: "bg-bad-dot", icon: "bg-bad-soft text-bad" },
  stub: { label: "testovacie", className: "text-ink-3", dot: "bg-ink-4", icon: "bg-fill text-ink-2" },
  unknown: { label: "neznáme", className: "text-warn", dot: "bg-warn-dot", icon: "bg-warn-soft text-warn" },
};

const SERVICE_HINT: Partial<Record<ServiceState, string>> = {
  down: "Doklady čakajú. Služba je momentálne nedostupná. Keď bude opäť dostupná, čítanie sa obnoví automaticky.",
  loading: "Doklady počkajú, kým sa model načíta.",
  unconfigured: "Doklady čakajú. Nastavenie služby chýba; je potrebné doplniť konfiguráciu aplikácie.",
};

/** Where the model lane's limit comes from, as the worker sized it. */
const MODEL_LIMIT_HINT: Record<ModelLimitSource, string> = {
  server: "(podľa -np na serveri)",
  fallback: "(záložne EXTRACTOR_CONCURRENCY, server neuviedol počet slotov)",
};

function ServiceCard({ title, health, subtitle }: { title: string; health: ServiceHealth; subtitle: string | null }) {
  const chip = STATE_CHIP[health.state];
  const hint = SERVICE_HINT[health.state];
  return (
    <div className="inset-group px-4 py-3.5" data-testid={`queue-service-${title.toLowerCase()}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`grid size-[34px] shrink-0 place-items-center rounded-[9px] ${chip.icon}`}>
          <Cpu className="size-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <p className="truncate text-[12.5px] text-ink-3" title={subtitle ?? undefined}>
            {subtitle ?? "—"}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${chip.className}`}>
          <span aria-hidden className={`size-2 rounded-full ${chip.dot}`} />
          {chip.label}
        </span>
      </div>
      {health.detail ? <p className="mt-2 text-[13px] text-ink-2">{health.detail}</p> : null}
      {hint ? <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn-strong">{hint}</p> : null}
    </div>
  );
}

function kindLabel(kind: QueueJobView["kind"]): string {
  return kind === "receipt" ? "Bloček" : "Doklad";
}

function JobWhere({ job }: { job: QueueJobView | FinishedJobView }) {
  return (
    <span className="text-[12.5px] text-ink-3">
      <Link href={`/companies/${job.companyId}/${job.monthKey}`} className="hover:text-accent hover:underline">
        {companyDisplayName(job.companyName)} · {monthLabel(job.monthKey)}
      </Link>{" "}
      · {kindLabel(job.kind)}
    </span>
  );
}

function RunningJob({ job }: { job: QueueJobView }) {
  return (
    <li className="border-t border-line px-4 py-3.5 first:border-t-0" data-testid="queue-running-job">
      <div className="flex items-center gap-2.5">
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" strokeWidth={2.6} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={job.fileName}>
          {job.fileName}
        </span>
        <span className="tabular shrink-0 text-[13px] text-ink-3">{formatElapsed(job.elapsedMs)}</span>
      </div>
      <JobWhere job={job} />
      <div className="mt-2.5 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={job.percent}
          aria-label={`${job.fileName}: ${job.stageLabel}`}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${job.percent}%` }} />
        </div>
        <span className="tabular w-10 text-right text-[13px] text-ink-2">{job.percent} %</span>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-3" data-testid="queue-running-stage">
        {job.stageLabel}
      </p>
    </li>
  );
}

const OUTCOME_CHIP: Record<FinishedJobView["outcome"], { label: string; className: string; mark: string; dot: string }> = {
  complete: { label: "Prečítaný", className: "text-good", mark: "✓", dot: "bg-good-dot" },
  failed: { label: "Zlyhal", className: "text-bad", mark: "!", dot: "bg-bad-dot" },
};

/** A finished document's stages, in the order they ran, each with its time and count. */
function StageBreakdown({ stages }: { stages: StageTiming[] }) {
  const ordered = TIMED_STAGES.flatMap((stage) => stages.filter((timing) => timing.stage === stage));
  if (ordered.length === 0) {
    return null;
  }
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-ink-3" data-testid="queue-recent-stages">
      {ordered.map((timing) => {
        const detail = stageDetail(timing);
        return (
          <li key={timing.stage} className="whitespace-nowrap">
            {TIMED_STAGE_LABEL[timing.stage]} <span className="tabular text-ink-2">{formatStageDuration(timing.durationMs)}</span>
            {detail ? <span> · {detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Per stage, the median and the 90th percentile over the recent documents that
 * kept their stages: a change to the worker or the node is judged by these.
 */
function StageSummary({ records }: { records: FinishedJobView[] }) {
  const summaries = summarizeStages(records);
  const timed = records.filter((job) => job.stages !== undefined).length;
  return (
    <Section title="Časy fáz" count={timed}>
      {summaries.length > 0 ? (
        <div data-testid="queue-stage-summary">
          <p className="px-4 pt-3 text-[12.5px] text-ink-3">Medián a 90. percentil za posledné doklady s rozpisom.</p>
          <ul>
            <li className="mt-1 grid grid-cols-[1fr_auto_auto] gap-x-6 border-t border-line px-4 py-2 text-[12.5px] text-ink-3">
              <span>Fáza</span>
              <span className="text-right">Medián</span>
              <span className="text-right">90. %</span>
            </li>
            {summaries.map((summary) => (
              <li
                key={summary.stage}
                className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-t border-line px-4 py-2.5 text-[14px]"
                data-testid="queue-stage-summary-row"
              >
                <span>
                  {TIMED_STAGE_LABEL[summary.stage]} <span className="text-[12.5px] text-ink-3">· {summary.count}</span>
                </span>
                <span className="tabular text-right">{formatStageDuration(summary.medianMs)}</span>
                <span className="tabular text-right text-ink-2">{formatStageDuration(summary.p90Ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-4 py-3.5 text-[14px] text-ink-3">
          Rozpis fáz sa ukladá pri každom ďalšom doklade. Staršie doklady ho nemajú.
        </p>
      )}
    </Section>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <header className="flex items-baseline gap-2 px-1 pb-2">
        <h2 className="text-[20px] font-bold tracking-[-0.015em]">{title}</h2>
        {count !== undefined ? <span className="tabular text-[14px] text-ink-3">{count}</span> : null}
      </header>
      <div className="inset-group">{children}</div>
    </section>
  );
}

/**
 * One lane: what it is reading, or the model is writing, and what waits behind
 * it. Each lane keeps its own order; a document moves from the first to the
 * second once its reading is done.
 */
function LaneSection({
  lane,
  title,
  idle,
  running,
  waiting,
}: {
  lane: QueueLane;
  title: string;
  idle: string;
  running: QueueJobView[];
  waiting: QueueJobView[];
}) {
  return (
    <Section title={title} count={running.length + waiting.length}>
      <div data-testid={`queue-lane-${lane}`}>
        {running.length > 0 ? (
          <ul>
            {running.map((job) => (
              <RunningJob key={`${job.lane}-${job.driveFileId}`} job={job} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3.5 text-[14px] text-ink-3">{idle}</p>
        )}
        {waiting.length > 0 ? (
          <>
            <p className="border-t border-line px-4 pt-2.5 text-[12.5px] text-ink-3">V rade · {waiting.length}</p>
            <ol>
              {waiting.map((job, index) => (
                <li
                  key={`${job.lane}-${job.driveFileId}`}
                  className="flex items-baseline gap-3 border-t border-line px-4 py-2.5 first:border-t-0"
                  data-testid="queue-waiting-job"
                >
                  <span className="tabular w-6 shrink-0 text-right text-[13px] text-ink-3">{index + 1}.</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px]" title={job.fileName}>
                      {job.fileName}
                    </span>
                    <JobWhere job={job} />
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * The one extraction queue, live: which document is being read and how far,
 * what waits behind it, how the last ones ended, and whether the model and
 * OCR can read anything at all.
 */
export function QueuePanel({ initial }: { initial: ExtractionQueueView }) {
  const { view: polled, stale } = useExtractionQueue(initial);
  const view = polled ?? initial;
  const { model, ocr } = view.services;

  return (
    <div className="flex flex-col gap-7">
      <div className="grid gap-3 sm:grid-cols-2">
        <ServiceCard
          title="Model"
          health={model}
          subtitle={model.url ? `${model.model ?? "?"} · ${model.url}` : null}
        />
        <ServiceCard title="OCR" health={ocr} subtitle={ocr.url} />
      </div>

      {!view.workerAlive ? (
        <p
          className="rounded-xl bg-bad-soft px-4 py-3 text-[13.5px] text-bad-strong"
          data-testid="queue-no-worker"
          role="alert"
        >
          <strong className="font-semibold">Doklady sa nečítajú — nebeží žiadny worker.</strong> Spusti ho (HUGO_ROLE=worker, alebo npm run dev so všetkým v
          jednom procese).
        </p>
      ) : null}

      {stale ? (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-[13.5px] text-warn-strong">
          Stav sa nepodarilo obnoviť — zobrazujem posledný známy.
        </p>
      ) : null}

      <LaneSection
        lane="read"
        title="Čítanie dokladov"
        idle="Nič sa nečíta. Rad sa plní pri otvorení mesiaca, pri zmene v Drive a každých 15 minút."
        running={view.running.filter((job) => job.lane === "read")}
        waiting={view.waiting.filter((job) => job.lane === "read")}
      />

      <LaneSection
        lane="model"
        title="Model"
        idle="Model nič nepíše. Doklady sa sem dostanú hneď, ako ich čítanie pripraví."
        running={view.running.filter((job) => job.lane === "model")}
        waiting={view.waiting.filter((job) => job.lane === "model")}
      />

      {view.delayed.length > 0 ? (
        <Section title="Čaká na službu" count={view.delayed.length}>
          <ul>
            {view.delayed.map((job) => (
              <li key={job.driveFileId} className="border-t border-line px-4 py-2.5 first:border-t-0" data-testid="queue-delayed-job">
                <span className="block truncate text-[14px] font-medium" title={job.fileName}>
                  {job.fileName}
                </span>
                <JobWhere job={job} />
                <p className="mt-0.5 text-[12.5px] text-ink-3">{job.stageLabel}</p>
                {job.waitingReason ? <p className="mt-0.5 text-[12.5px] text-warn">{job.waitingReason}</p> : null}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
            Skúsia sa znova, hneď ako je služba späť, najneskôr o minútu.
          </p>
        </Section>
      ) : null}

      <StageSummary records={view.recent} />

      <Section title="Naposledy" count={view.recent.length}>
        {view.recent.length > 0 ? (
          <ul>
            {view.recent.map((job) => {
              const chip = OUTCOME_CHIP[job.outcome];
              return (
                <li key={job.driveFileId} className="flex items-start gap-3 border-t border-line px-4 py-2.5 first:border-t-0" data-testid="queue-recent-job">
                  <span aria-hidden className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white ${chip.dot}`}>
                    {chip.mark}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px]" title={job.fileName}>
                        {job.fileName}
                      </span>
                      <span className="tabular shrink-0 text-[12.5px] text-ink-3">
                        {formatElapsed(job.durationMs)} · {formatTime(job.finishedAt)}
                      </span>
                    </div>
                    <span className="flex flex-wrap gap-x-1.5">
                      <JobWhere job={job} />
                      <span className={`text-[12.5px] ${chip.className}`}>· {chip.label}</span>
                    </span>
                    {job.stages ? <StageBreakdown stages={job.stages} /> : null}
                    {job.reason ? <p className="mt-0.5 text-[12.5px] text-ink-2">{extractionFailureMessage(job.reason)}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-3.5 text-[14px] text-ink-3">
            Zatiaľ sa nič neprečítalo.
          </p>
        )}
      </Section>

      <p className="px-1 text-[12.5px] text-ink-3">
        Bežiace workery: {view.workers} · čítanie naraz najviac {countWithNoun(view.concurrency.read, DOKLAD_FORMS)}
        (READ_CONCURRENCY), model naraz najviac {countWithNoun(view.concurrency.model, DOKLAD_FORMS)}
        {MODEL_LIMIT_HINT[view.modelSource ?? "fallback"]}.
        Percentá sú odhad: model hlási prečítaný text a napísané tokeny, zvyšok sa odhaduje podľa času. Rad je v
        Redise, spoločný pre všetky repliky; stav sa posiela sám, keď sa zmení.
      </p>
    </div>
  );
}
