"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import type {
  DocumentListItem,
  FolderFilterOption,
  ReadOnlyFile,
} from "@/lib/documents/view";
import { driveFileViewUrl } from "@/modules/file-preview";
import {
  documentSortQuery,
  filterReadOnlyFiles,
  normalizeDocumentSearch,
  type DocumentSortDirection,
  type DocumentSortKey,
} from "@/modules/document-browser";
import type { LiveExtraction } from "@/modules/month-extraction-watch";

type DocumentRailProps = {
  documents: DocumentListItem[];
  folderFilters: FolderFilterOption[];
  folderFilter: string | null;
  totalCount: number;
  search: string;
  onSearchChange: (search: string) => void;
  sortKey: DocumentSortKey;
  sortDirection: DocumentSortDirection;
  readOnlyFiles: ReadOnlyFile[];
  selectedDocumentId: string | null;
  /** From the extraction queue, by Drive file id; empty when nothing is pending. */
  liveExtraction: Map<string, LiveExtraction>;
  onSelect: (documentId: string) => void;
  basePath: string;
};

/**
 * Rows show what a document *is*; they never carry the control that changes it.
 * That control is the decision bar under the preview — one large, labelled
 * target instead of a checkbox in the corner of a row.
 */
export function DocumentRail({
  documents,
  folderFilters,
  folderFilter,
  totalCount,
  search,
  onSearchChange,
  sortKey,
  sortDirection,
  readOnlyFiles,
  selectedDocumentId,
  liveExtraction,
  onSelect,
  basePath,
}: DocumentRailProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const normalizedSearch = normalizeDocumentSearch(search);
  const visibleReadOnlyFiles = useMemo(
    () => filterReadOnlyFiles(readOnlyFiles, normalizedSearch),
    [normalizedSearch, readOnlyFiles],
  );

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function folderHref(folder: string | null): string {
    const params = new URLSearchParams(documentSortQuery(sortKey, sortDirection));
    if (folder) {
      params.set("folder", folder);
    }
    return `${basePath}?${params.toString()}`;
  }

  function changeSort(nextKey: DocumentSortKey) {
    const params = new URLSearchParams(documentSortQuery(nextKey, sortDirection));
    if (folderFilter) {
      params.set("folder", folderFilter);
    }
    router.push(`${basePath}?${params.toString()}`, { scroll: false });
  }

  function changeDirection() {
    const nextDirection = sortDirection === "asc" ? "desc" : "asc";
    const params = new URLSearchParams(documentSortQuery(sortKey, nextDirection));
    if (folderFilter) {
      params.set("folder", folderFilter);
    }
    router.push(`${basePath}?${params.toString()}`, { scroll: false });
  }

  return (
    <div ref={browserRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3">
        <h2 className="eyebrow">Doklady</h2>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-ink-3">{documents.length}</span>
      </div>

      {folderFilters.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-2.5 py-2">
            <FilterChip
            href={folderHref(null)}
            active={folderFilter === null}
            label="Všetky"
            count={totalCount}
            title="Všetky spracúvané priečinky"
          />
          {folderFilters.map((option) => (
            <FilterChip
              key={option.slot}
              href={folderHref(option.slot)}
              active={folderFilter === option.slot}
              label={option.shortLabel}
              count={option.count}
              title={option.slot}
            />
          ))}
        </div>
      ) : null}

      <div className="shrink-0 border-b border-line bg-surface px-2.5 py-2" data-testid="document-browser-toolbar">
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="document-browser-search">Hľadať doklad</label>
          <div className="relative min-w-0 flex-1">
            <input
              ref={searchRef}
              id="document-browser-search"
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onSearchChange("");
                  searchRef.current?.blur();
                  browserRef.current?.focus();
                }
              }}
              placeholder="Hľadať doklad…"
              className="h-8 w-full rounded border border-line-2 bg-surface-2 px-2.5 pr-8 text-[12px] outline-none placeholder:text-ink-3 focus:border-accent focus:bg-surface"
              data-testid="document-search"
            />
            {search.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  onSearchChange("");
                  searchRef.current?.focus();
                }}
                className="absolute inset-y-0 right-0 px-2 text-[14px] text-ink-3 hover:text-ink"
                aria-label="Vymazať hľadanie"
                data-testid="document-search-clear"
              >
                ×
              </button>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-3" data-testid="document-count">
            {documents.length}/{totalCount}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 max-[420px]:flex-col max-[420px]:items-stretch">
          <label className="sr-only" htmlFor="document-sort">Zoradiť doklady</label>
          <select
            id="document-sort"
            value={sortKey}
            onChange={(event) => changeSort(event.target.value as DocumentSortKey)}
            className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-1.5 text-[11px] text-ink-2"
            data-testid="document-sort"
          >
            <option value="issueDate">Vystavené</option>
            <option value="price">Cena</option>
            <option value="partner">Partner</option>
            <option value="filename">Názov súboru</option>
            <option value="status">Stav</option>
          </select>
          <button
            type="button"
            onClick={changeDirection}
            className="h-7 shrink-0 rounded border border-line px-2 font-mono text-[11px] text-ink-2 hover:bg-surface-2"
            aria-label={`Smer triedenia: ${sortDirection === "asc" ? "vzostupne" : "zostupne"}`}
            data-testid="document-sort-direction"
          >
            {sortDirection === "asc" ? "↑ A–Z" : "↓ Z–A"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {documents.length === 0 ? (
          <p className="p-2 text-sm text-ink-3">
            {normalizedSearch
              ? "Hľadaniu nezodpovedá žiadny doklad."
              : folderFilter
              ? "V tomto priečinku nie sú žiadne doklady."
              : "V tomto mesiaci zatiaľ nie sú žiadne doklady."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            <li className="grid grid-cols-[18px_minmax(0,1fr)_auto_auto] gap-2.5 px-[7px] pb-0.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-ink-3 max-[420px]:grid-cols-[18px_minmax(0,1fr)]" aria-hidden>
              <span />
              <span>Doklad</span>
              <span className="max-[420px]:col-start-2 max-[420px]:row-start-2">Cena</span>
              <span className="max-[420px]:col-start-2 max-[420px]:row-start-3">Vystavené</span>
            </li>
            {documents.map((document) => {
              const selected = document.id === selectedDocumentId;
              const dismissed = document.decision === "not_relevant";

              return (
                <li key={document.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(document.id)}
                    data-testid="month-document-row"
                    data-document-id={document.id}
                    // The label turns into the supplier once extraction reads it.
                    title={document.name}
                    aria-current={selected ? "true" : undefined}
                    className={`grid w-full grid-cols-[18px_minmax(0,1fr)_auto_auto] items-start gap-2.5 rounded-md border-l-2 py-2 pl-[7px] pr-2.5 text-left max-[420px]:grid-cols-[18px_minmax(0,1fr)] ${
                      selected
                        ? "border-l-accent bg-accent-soft"
                        : "border-l-transparent hover:bg-surface-2"
                    }`}
                  >
                    <StateGlyph document={document} />
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[12.5px] font-medium ${
                          dismissed ? "text-ink-3" : ""
                        }`}
                      >
                        {document.label}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-ink-3">
                        {document.folderSlot}
                        {document.receiptOfFile
                          ? ` · bloček ${document.receiptOfFile.index} z ${document.receiptOfFile.count}`
                          : ""}
                      </span>
                      {document.sameReceiptAs.length > 0 && document.decision === null ? (
                        <span className="block truncate text-[11px] text-warn">
                          Rovnaký bloček aj v {document.sameReceiptAs[0]!.fileName}
                        </span>
                      ) : null}
                      {document.decision === null &&
                      document.derivedStatus.kind === "pending-extraction" ? (
                        <PendingHint
                          live={liveExtraction.get(document.driveFileId)}
                          fallback={document.derivedStatus.hint}
                        />
                      ) : document.decision === null &&
                        document.derivedStatus.kind !== "awaiting-decision" ? (
                        <span
                          className={`block truncate text-[11px] ${
                            document.derivedStatus.kind === "manual-entry" ? "text-warn" : "text-ink-3"
                          }`}
                        >
                          {document.derivedStatus.hint}
                        </span>
                      ) : null}
                      {dismissed && document.notRelevantReason ? (
                        <span className="block truncate text-[11px] text-ink-3">
                          „{document.notRelevantReason}“
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`pt-px font-mono text-[12px] whitespace-nowrap max-[420px]:col-start-2 max-[420px]:row-start-2 ${
                        dismissed ? "text-ink-3" : "text-ink-2"
                      }`}
                    >
                      {document.amountDisplay}
                    </span>
                    <span className="pt-px font-mono text-[11px] whitespace-nowrap text-ink-3 max-[420px]:col-start-2 max-[420px]:row-start-3">
                      {document.issueDateDisplay}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {readOnlyFiles.length > 0 ? (
          <section
            className="mt-3 border-t border-line pt-2.5"
            data-testid="folder-group-vat-output"
          >
            <h3 className="eyebrow px-2">Výstupy DPH — len na čítanie</h3>
            <p className="px-2 pt-1 text-[11px] text-ink-3">
              Súbory v koreni mesiaca. Nikdy sa nespracúvajú ako vstupné doklady.
            </p>
            <ul className="mt-1.5 flex flex-col">
              {visibleReadOnlyFiles.map((file) => (
                <li key={file.driveFileId} data-testid="month-document">
                  <a
                    href={driveFileViewUrl(file.driveFileId)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate rounded-md px-2 py-1 font-mono text-[11.5px] text-ink-3 hover:bg-surface-2 hover:text-accent"
                    title={file.name}
                  >
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
            {visibleReadOnlyFiles.length === 0 ? (
              <p className="px-2 pt-1 text-[11px] text-ink-3">Hľadaniu nezodpovedá žiadny výstup.</p>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2.5 border-t border-line bg-surface-2 px-3 py-2 text-[10.5px] text-ink-3">
        <Legend className="border-[1.5px] border-ink-3" label="čaká" />
        <Legend className="bg-good" label="potvrdené" />
        <Legend className="border-[1.5px] border-ink-3 bg-surface-3" label="nerelevantné" />
        <Legend className="bg-warn" label="ručne" />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className={`inline-block size-[9px] rounded-full ${className}`} />
      {label}
    </span>
  );
}

function StateGlyph({ document }: { document: DocumentListItem }) {
  const base =
    "mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold leading-none";

  if (document.decision === "confirmed") {
    return (
      <span className={`${base} bg-good text-good-ink`} title="Potvrdené" aria-label="Potvrdené">
        ✓
      </span>
    );
  }
  if (document.decision === "not_relevant") {
    return (
      <span
        className={`${base} border-[1.5px] border-ink-3 text-[11px] text-ink-3`}
        title="Nerelevantné"
        aria-label="Nerelevantné"
      >
        –
      </span>
    );
  }
  if (document.derivedStatus.kind === "manual-entry") {
    return (
      <span
        className={`${base} bg-warn text-warn-soft`}
        title="Treba vyplniť ručne"
        aria-label="Treba vyplniť ručne"
      >
        !
      </span>
    );
  }
  return (
    <span
      className={`${base} border-[1.5px] border-ink-3`}
      title="Čaká na rozhodnutie"
      aria-label="Čaká na rozhodnutie"
    />
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
  title,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  title: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      scroll={false}
      aria-current={active ? "true" : undefined}
      data-testid="folder-filter"
      className={`rounded-full border px-2.5 py-[2.5px] text-[11.5px] ${
        active
          ? "border-ink bg-ink font-medium text-surface"
          : "border-line bg-surface text-ink-2 hover:border-line-2 hover:bg-surface-2"
      }`}
    >
      {label}
      <span className="ml-1 opacity-60">{count}</span>
    </Link>
  );
}

/** A document being read: its stage and share from the queue, its place in it, or what it waits for. */
function PendingHint({ live, fallback }: { live: LiveExtraction | undefined; fallback: string }) {
  if (live?.state === "running") {
    return (
      <span className="block" data-testid="document-extraction-progress">
        <span className="block truncate text-[11px] text-accent" title={live.stageLabel}>
          {live.percent} % · {live.stageLabel}
        </span>
        <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-700"
            style={{ width: `${live.percent}%` }}
          />
        </span>
      </span>
    );
  }
  if (live?.state === "waiting") {
    return <span className="block truncate text-[11px] text-accent">V rade · {live.position}.</span>;
  }
  if (live?.state === "blocked") {
    return <span className="block truncate text-[11px] text-warn">{live.label}</span>;
  }
  return <span className="block truncate text-[11px] text-accent">{fallback}</span>;
}
