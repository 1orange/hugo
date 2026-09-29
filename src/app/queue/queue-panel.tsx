"use client";

import Link from "next/link";
import { useExtractionQueue } from "@/components/app/use-extraction-queue";
import type { FinishedJobView, QueueJobView } from "@/lib/extraction-queue/types";
import type { ServiceHealth, ServiceState } from "@/lib/extraction-queue/service-health";
import type { ExtractionQueueView } from "@/lib/extraction-queue/view";
import { formatElapsed } from "@/modules/extraction-progress";
import { countWithNoun, DOKLAD_FORMS, formatTime, monthLabel } from "@/modules/format-sk";

const STATE_CHIP: Record<ServiceState, { label: string; className: string }> = {
  ok: { label: "beží", className: "bg-good-soft text-good" },
  loading: { label: "načítava sa", className: "bg-warn-soft text-warn" },
  down: { label: "nedostupné", className: "bg-bad-soft text-bad" },
  unconfigured: { label: "nenastavené", className: "bg-bad-soft text-bad" },
  stub: { label: "testovacie", className: "bg-surface-3 text-ink-2" },
  unknown: { label: "neznáme", className: "bg-warn-soft text-warn" },
};

const SERVICE_HINT: Partial<Record<ServiceState, string>> = {
  down: "Doklady čakajú. Spusti sidecary: docker compose --env-file .env.docker up -d",
  loading: "Doklady počkajú, kým sa model načíta.",
  unconfigured: "Doklady čakajú. Doplň hodnoty do .env a reštartuj npm run dev.",
};

function ServiceCard({ title, health, subtitle }: { title: string; health: ServiceHealth; subtitle: string | null }) {
  const chip = STATE_CHIP[health.state];
  const hint = SERVICE_HINT[health.state];
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3" data-testid={`queue-service-${title.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className={`rounded-full px-2 py-[1px] text-[11px] font-medium ${chip.className}`}>{chip.label}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[11.5px] text-ink-3" title={subtitle ?? undefined}>
        {subtitle ?? "—"}
      </p>
      {health.detail ? <p className="mt-1 text-[12px] text-ink-2">{health.detail}</p> : null}
      {hint ? <p className="mt-1 text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function kindLabel(kind: QueueJobView["kind"]): string {
  return kind === "receipt" ? "Bloček" : "Doklad";
}

function JobWhere({ job }: { job: QueueJobView | FinishedJobView }) {
  return (
    <span className="text-[12px] text-ink-3">
      <Link href={`/companies/${job.companyId}/${job.monthKey}`} className="hover:text-accent hover:underline">
        {job.companyName} · {monthLabel(job.monthKey)}
      </Link>{" "}
      · {kindLabel(job.kind)}
    </span>
  );
}

function RunningJob({ job }: { job: QueueJobView }) {
  return (
    <li className="px-4 py-3" data-testid="queue-running-job">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] font-semibold" title={job.fileName}>
          {job.fileName}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-2">{formatElapsed(job.elapsedMs)}</span>
      </div>
      <JobWhere job={job} />
      <div className="mt-2 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={job.percent}
          aria-label={`${job.fileName}: ${job.stageLabel}`}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${job.percent}%` }} />
        </div>
        <span className="w-10 text-right font-mono text-[12px] tabular-nums text-ink-2">{job.percent} %</span>
      </div>
      <p className="mt-1 text-[12px] text-ink-2" data-testid="queue-running-stage">
        {job.stageLabel}
      </p>
    </li>
  );
}

const OUTCOME_CHIP: Record<FinishedJobView["outcome"], { label: string; className: string }> = {
  complete: { label: "Prečítaný", className: "bg-good-soft text-good" },
  failed: { label: "Zlyhal", className: "bg-bad-soft text-bad" },
};

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[14px]">{title}</h2>
        {count !== undefined ? <span className="font-mono text-[12px] text-ink-3">{count}</span> : null}
      </header>
      {children}
    </section>
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
    <div className="flex flex-col gap-5">
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
          className="rounded-md border-l-2 border-bad bg-bad-soft px-3 py-2 text-[12.5px] text-bad"
          data-testid="queue-no-worker"
        >
          Žiadny worker nebeží, doklady sa nečítajú. Spusti ho (HUGO_ROLE=worker, alebo npm run dev so všetkým v
          jednom procese).
        </p>
      ) : null}

      {stale ? (
        <p className="rounded-md border-l-2 border-warn bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          Stav sa nepodarilo obnoviť — zobrazujem posledný známy.
        </p>
      ) : null}

      <Section title="Práve sa číta" count={view.running.length}>
        {view.running.length > 0 ? (
          <ul className="divide-y divide-line">
            {view.running.map((job) => (
              <RunningJob key={job.driveFileId} job={job} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-ink-3">
            Nič sa nečíta. Rad sa plní pri otvorení mesiaca, pri zmene v Drive a každých 15 minút.
          </p>
        )}
      </Section>

      <Section title="V rade" count={view.waiting.length}>
        {view.waiting.length > 0 ? (
          <ol className="divide-y divide-line">
            {view.waiting.map((job, index) => (
              <li key={job.driveFileId} className="flex items-baseline gap-3 px-4 py-2" data-testid="queue-waiting-job">
                <span className="w-6 shrink-0 text-right font-mono text-[12px] text-ink-3">{index + 1}.</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px]" title={job.fileName}>
                    {job.fileName}
                  </span>
                  <JobWhere job={job} />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-3 text-[13px] text-ink-3">Rad je prázdny.</p>
        )}
      </Section>

      {view.delayed.length > 0 ? (
        <Section title="Čaká na službu" count={view.delayed.length}>
          <ul className="divide-y divide-line">
            {view.delayed.map((job) => (
              <li key={job.driveFileId} className="px-4 py-2" data-testid="queue-delayed-job">
                <span className="block truncate text-[13px]" title={job.fileName}>
                  {job.fileName}
                </span>
                <JobWhere job={job} />
                {job.waitingReason ? <p className="mt-0.5 text-[12px] text-warn">{job.waitingReason}</p> : null}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">
            Skúsia sa znova, hneď ako je služba späť, najneskôr o minútu.
          </p>
        </Section>
      ) : null}

      <Section title="Naposledy" count={view.recent.length}>
        {view.recent.length > 0 ? (
          <ul className="divide-y divide-line">
            {view.recent.map((job) => {
              const chip = OUTCOME_CHIP[job.outcome];
              return (
                <li key={job.driveFileId} className="px-4 py-2" data-testid="queue-recent-job">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px]" title={job.fileName}>
                      {job.fileName}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-[1px] text-[11px] font-medium ${chip.className}`}>
                        {chip.label}
                      </span>
                      <span className="font-mono text-[11.5px] tabular-nums text-ink-3">
                        {formatElapsed(job.durationMs)} · {formatTime(job.finishedAt)}
                      </span>
                    </span>
                  </div>
                  <JobWhere job={job} />
                  {job.reason ? <p className="mt-0.5 text-[12px] text-ink-2">{job.reason}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-ink-3">
            Zatiaľ sa nič neprečítalo.
          </p>
        )}
      </Section>

      <p className="text-[12px] text-ink-3">
        Bežiace workery: {view.workers} · naraz najviac {countWithNoun(view.concurrency, DOKLAD_FORMS)} spolu
        (EXTRACTOR_CONCURRENCY).
        Percentá sú odhad: model hlási prečítaný text a napísané tokeny, zvyšok sa odhaduje podľa času. Rad je v
        Redise, spoločný pre všetky repliky; stav sa posiela sám, keď sa zmení.
      </p>
    </div>
  );
}
