"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { MessageSquare, Search, X } from "lucide-react";
import type {
  DocumentListItem,
  FolderFilterOption,
  ReadOnlyFile,
} from "@/lib/documents/view";
import { driveFileViewUrl } from "@/modules/file-preview";
import {
  documentSortQuery,
  filterReadOnlyFiles,
  hasSubjectProblem,
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
  /** Documents in this folder scope with a party whose verdict is a mismatch. */
  subjectProblemCount: number;
  subjectProblemsOnly: boolean;
  onSubjectProblemsOnlyChange: (next: boolean) => void;
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
  subjectProblemCount,
  subjectProblemsOnly,
  onSubjectProblemsOnlyChange,
}: DocumentRailProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const normalizedSearch = normalizeDocumentSearch(search);
  const visibleReadOnlyFiles = useMemo(
    () => filterReadOnlyFiles(readOnlyFiles, normalizedSearch),
    [normalizedSearch, readOnlyFiles],
  );
  // Narrowing to problems hides the VAT outputs: they carry no party, so none can be one.
  const showReadOnlyFiles = readOnlyFiles.length > 0 && !subjectProblemsOnly;

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
    <div ref={browserRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col bg-surface-2 outline-none">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2" data-testid="document-browser-toolbar">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="document-browser-search">Hľadať doklad</label>
          <div className="relative flex min-w-0 flex-1 items-center rounded-[9px] bg-fill text-ink-3 focus-within:bg-surface focus-within:shadow-[0_0_0_2px_rgb(43_93_114/0.45)]">
            <Search aria-hidden className="ml-2.5 size-3.5 shrink-0" strokeWidth={2.2} />
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
              placeholder="Hľadať aj v poznámkach"
              className="h-8 w-full min-w-0 bg-transparent px-2 pr-7 text-[13.5px] text-ink outline-none placeholder:text-ink-4 [&::-webkit-search-cancel-button]:hidden"
              data-testid="document-search"
            />
            {search.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  onSearchChange("");
                  searchRef.current?.focus();
                }}
                className="absolute inset-y-0 right-0 grid w-7 place-items-center text-ink-3 hover:text-ink"
                aria-label="Vymazať hľadanie"
                data-testid="document-search-clear"
              >
                <X aria-hidden className="size-3.5" strokeWidth={2.4} />
              </button>
            ) : null}
          </div>
          <span className="tabular shrink-0 text-[12px] text-ink-3" data-testid="document-count">
            {documents.length}/{totalCount}
          </span>
        </div>

        {folderFilters.length > 0 ? (
          <nav aria-label="Priečinky" className="segmented flex w-full">
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
          </nav>
        ) : null}

        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="document-sort">Zoradiť doklady</label>
          <select
            id="document-sort"
            value={sortKey}
            onChange={(event) => changeSort(event.target.value as DocumentSortKey)}
            className="h-7 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[12.5px] text-ink-2 hover:bg-fill"
            data-testid="document-sort"
          >
            <option value="issueDate">Podľa dátumu vystavenia</option>
            <option value="price">Podľa ceny</option>
            <option value="partner">Podľa partnera</option>
            <option value="filename">Podľa názvu súboru</option>
            <option value="status">Podľa stavu</option>
          </select>
          <button
            type="button"
            onClick={changeDirection}
            className="press h-7 shrink-0 rounded-lg px-2 text-[12.5px] text-ink-2 hover:bg-fill"
            aria-label={`Smer triedenia: ${sortDirection === "asc" ? "vzostupne" : "zostupne"}`}
            data-testid="document-sort-direction"
          >
            {sortDirection === "asc" ? "↑ A–Z" : "↓ Z–A"}
          </button>
          <button
            type="button"
            onClick={() => onSubjectProblemsOnlyChange(!subjectProblemsOnly)}
            aria-pressed={subjectProblemsOnly}
            title="Zobraziť len doklady, ktorých strana nesedí s registrom"
            className={`press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] ${
              subjectProblemsOnly
                ? "bg-bad-soft font-semibold text-bad"
                : subjectProblemCount > 0
                  ? "text-bad hover:bg-fill"
                  : "text-ink-3 hover:bg-fill"
            }`}
            data-testid="rail-filter-integrity"
          >
            <span aria-hidden>▲</span>
            <span className="sr-only">Len s problémom subjektu</span>
            <span className="tabular">{subjectProblemCount}</span>
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {documents.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-ink-3">
            {normalizedSearch
              ? "Hľadaniu nezodpovedá žiadny doklad."
              : subjectProblemsOnly
              ? "Žiadny doklad nemá problém so subjektom."
              : folderFilter
              ? "V tomto priečinku nie sú žiadne doklady."
              : "V tomto mesiaci zatiaľ nie sú žiadne doklady."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Doklady mesiaca">
            {documents.map((document) => {
              const selected = document.id === selectedDocumentId;
              const dismissed = document.decision === "not_relevant";
              const vat = document.fieldEditor.fields.recapVatLiteral.trim();

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
                    className={`group press flex w-full items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-100 ${
                      selected ? "bg-accent text-white" : "text-ink hover:bg-black/[0.035]"
                    } ${dismissed && !selected ? "opacity-60" : ""}`}
                  >
                    <StateGlyph document={document} selected={selected} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="block min-w-0 truncate text-[13.5px] font-semibold">{document.label}</span>
                          {hasSubjectProblem(document) ? (
                            <SubjectProblemMark documentId={document.id} selected={selected} />
                          ) : null}
                        </span>
                        <span className="tabular shrink-0 text-[13px] font-medium">{document.amountDisplay}</span>
                      </span>
                      <span className={`mt-px flex items-baseline gap-2 text-[12px] ${selected ? "text-white/80" : "text-ink-3"}`}>
                        {/* The date first, so a long folder name never pushes it out of view. */}
                        <DocumentDate document={document} />
                        <span className="min-w-0 flex-1 truncate" title={document.folderSlot}>
                          {document.folderSlot}
                          {document.receiptOfFile
                            ? ` · bloček ${document.receiptOfFile.index} z ${document.receiptOfFile.count}`
                            : ""}
                        </span>
                        {vat ? <span className="tabular shrink-0">DPH {vat}</span> : null}
                      </span>
                      {document.sameReceiptAs.length > 0 && document.decision === null ? (
                        <span className={`mt-0.5 block truncate text-[12px] ${selected ? "text-white/85" : "text-warn"}`}>
                          Rovnaký bloček aj v {document.sameReceiptAs[0]!.fileName}
                        </span>
                      ) : null}
                      {document.decision === null && document.derivedStatus.kind === "pending-extraction" ? (
                        <PendingHint
                          live={liveExtraction.get(document.driveFileId)}
                          fallback={document.derivedStatus.hint}
                          selected={selected}
                        />
                      ) : document.decision === null && document.derivedStatus.kind !== "awaiting-decision" ? (
                        <span
                          className={`mt-0.5 block truncate text-[12px] ${
                            selected
                              ? "text-white/85"
                              : document.derivedStatus.kind === "manual-entry"
                                ? "text-warn"
                                : "text-ink-3"
                          }`}
                        >
                          {document.derivedStatus.hint}
                        </span>
                      ) : null}
                      {dismissed ? (
                        <span className={`mt-0.5 block truncate text-[12px] italic ${selected ? "text-white/85" : "text-ink-3"}`}>
                          Nerelevantné{document.notRelevantReason ? `: ${document.notRelevantReason}` : ""}
                        </span>
                      ) : null}
                      {document.note ? (
                        <span className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${selected ? "text-white/85" : "text-ink-3"}`}>
                          <MessageSquare aria-hidden className="size-3 shrink-0" strokeWidth={2} />
                          <span className="truncate">{document.note}</span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {showReadOnlyFiles ? (
          <section className="mx-1 mt-4 border-t border-line pt-3" data-testid="folder-group-vat-output">
            <h3 className="eyebrow px-1.5">Výstupy DPH — len na čítanie</h3>
            <p className="px-1.5 pt-0.5 text-[12px] text-ink-3">Súbory v koreni mesiaca. Nikdy sa nespracúvajú ako doklady.</p>
            <ul className="mt-1.5 flex flex-col">
              {visibleReadOnlyFiles.map((file) => (
                <li key={file.driveFileId} data-testid="month-document">
                  <a
                    href={driveFileViewUrl(file.driveFileId)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate rounded-lg px-1.5 py-1 text-[12.5px] text-ink-3 hover:bg-fill hover:text-accent"
                    title={file.name}
                  >
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
            {visibleReadOnlyFiles.length === 0 ? (
              <p className="px-1.5 pt-1 text-[12px] text-ink-3">Hľadaniu nezodpovedá žiadny výstup.</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The document's issue date once it is read; before that, the day the file
 * reached Drive, marked as such.
 */
function DocumentDate({ document }: { document: DocumentListItem }) {
  const issued = document.issueDateDisplay && document.issueDateDisplay !== "—" ? document.issueDateDisplay : null;
  const uploaded = document.fileDateDisplay && document.fileDateDisplay !== "—" ? document.fileDateDisplay : null;
  if (issued) {
    return (
      <span className="tabular shrink-0" title="Dátum vystavenia" data-testid="document-date">
        {issued}
      </span>
    );
  }
  if (uploaded) {
    return (
      <span className="tabular shrink-0" title="Nahraté do Drive" data-testid="document-date">
        nahraté {uploaded}
      </span>
    );
  }
  return null;
}

/** A party of this document disagrees with its register, VIES or profile. Notices do not mark. */
function SubjectProblemMark({ documentId, selected }: { documentId: string; selected: boolean }) {
  return (
    <span
      role="img"
      aria-label="Strana dokladu nesedí s registrom"
      title="Strana dokladu nesedí s registrom"
      data-testid={`rail-integrity-${documentId}`}
      className={`shrink-0 text-[10px] leading-none ${selected ? "text-[#ffd27a]" : "text-warn-dot"}`}
    >
      ▲
    </span>
  );
}

function StateGlyph({ document, selected }: { document: DocumentListItem; selected: boolean }) {
  const base = "mt-px grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] leading-none font-bold";

  if (document.decision === "confirmed") {
    return (
      <span className={`${base} bg-good-dot text-white`} title="Potvrdené" aria-label="Potvrdené">
        ✓
      </span>
    );
  }
  if (document.decision === "not_relevant") {
    return (
      <span className={`${base} bg-ink-4 text-[12px] text-white`} title="Nerelevantné" aria-label="Nerelevantné">
        –
      </span>
    );
  }
  if (document.derivedStatus.kind === "manual-entry") {
    return (
      <span className={`${base} bg-warn-dot text-white`} title="Treba vyplniť ručne" aria-label="Treba vyplniť ručne">
        !
      </span>
    );
  }
  return (
    <span
      className={`${base} ${selected ? "shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.85)]" : "shadow-[inset_0_0_0_1.5px_#a1a1a6]"}`}
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
      className={`segment flex-1 px-1.5 text-center text-[12.5px] ${active ? "!bg-surface !text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : ""}`}
    >
      {label}
      <span className="tabular ml-1 opacity-60">{count}</span>
    </Link>
  );
}

/** A document being read: its stage and share from the queue, its place in it, or what it waits for. */
function PendingHint({
  live,
  fallback,
  selected,
}: {
  live: LiveExtraction | undefined;
  fallback: string;
  selected: boolean;
}) {
  const ink = selected ? "text-white/85" : "text-accent";
  if (live?.state === "running") {
    return (
      <span className="block" data-testid="document-extraction-progress">
        <span className={`mt-0.5 block truncate text-[12px] ${ink}`} title={live.stageLabel}>
          {live.percent} % · {live.stageLabel}
        </span>
        <span className={`mt-1 block h-[3px] overflow-hidden rounded-full ${selected ? "bg-white/30" : "bg-fill-2"}`} aria-hidden>
          <span
            className={`block h-full rounded-full transition-[width] duration-700 ${selected ? "bg-white" : "bg-accent"}`}
            style={{ width: `${live.percent}%` }}
          />
        </span>
      </span>
    );
  }
  if (live?.state === "waiting") {
    return <span className={`mt-0.5 block truncate text-[12px] ${ink}`}>V rade · {live.position}.</span>;
  }
  if (live?.state === "blocked") {
    return <span className={`mt-0.5 block truncate text-[12px] ${selected ? "text-white/85" : "text-warn"}`}>{live.label}</span>;
  }
  return <span className={`mt-0.5 block truncate text-[12px] ${ink}`}>{fallback}</span>;
}
