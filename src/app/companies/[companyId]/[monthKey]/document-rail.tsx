"use client";

import Link from "next/link";
import type {
  DocumentListItem,
  FolderFilterOption,
  ReadOnlyFile,
} from "@/lib/documents/view";
import { driveFileViewUrl } from "@/modules/file-preview";

type DocumentRailProps = {
  documents: DocumentListItem[];
  folderFilters: FolderFilterOption[];
  folderFilter: string | null;
  totalCount: number;
  readOnlyFiles: ReadOnlyFile[];
  selectedDriveFileId: string | null;
  onSelect: (driveFileId: string) => void;
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
  readOnlyFiles,
  selectedDriveFileId,
  onSelect,
  basePath,
}: DocumentRailProps) {
  return (
    <>
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3">
        <h2 className="eyebrow">Doklady</h2>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-ink-3">{documents.length}</span>
      </div>

      {folderFilters.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-2.5 py-2">
          <FilterChip
            href={basePath}
            active={folderFilter === null}
            label="Všetky"
            count={totalCount}
            title="Všetky spracúvané priečinky"
          />
          {folderFilters.map((option) => (
            <FilterChip
              key={option.slot}
              href={`${basePath}?folder=${encodeURIComponent(option.slot)}`}
              active={folderFilter === option.slot}
              label={option.shortLabel}
              count={option.count}
              title={option.slot}
            />
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {documents.length === 0 ? (
          <p className="p-2 text-sm text-ink-3">
            {folderFilter
              ? "V tomto priečinku nie sú žiadne doklady."
              : "V tomto mesiaci zatiaľ nie sú žiadne doklady."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {documents.map((document) => {
              const selected = document.driveFileId === selectedDriveFileId;
              const dismissed = document.decision === "not_relevant";

              return (
                <li key={document.driveFileId}>
                  <button
                    type="button"
                    onClick={() => onSelect(document.driveFileId)}
                    data-testid="month-document-row"
                    aria-current={selected ? "true" : undefined}
                    className={`grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md border-l-2 py-2 pl-[7px] pr-2.5 text-left ${
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
                        {document.receiptDisplay !== "—"
                          ? ` · ${document.receiptDisplay}`
                          : ""}
                      </span>
                      {document.decision === null &&
                      document.derivedStatus.kind !== "awaiting-decision" ? (
                        <span
                          className={`block truncate text-[11px] ${
                            document.derivedStatus.kind === "manual-entry"
                              ? "text-warn"
                              : document.derivedStatus.kind === "pending-extraction"
                                ? "text-accent"
                                : "text-ink-3"
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
                      className={`pt-px font-mono text-[12px] whitespace-nowrap ${
                        dismissed ? "text-ink-3" : "text-ink-2"
                      }`}
                    >
                      {document.amountDisplay}
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
              {readOnlyFiles.map((file) => (
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
          </section>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2.5 border-t border-line bg-surface-2 px-3 py-2 text-[10.5px] text-ink-3">
        <Legend className="border-[1.5px] border-ink-3" label="čaká" />
        <Legend className="bg-good" label="potvrdené" />
        <Legend className="border-[1.5px] border-ink-3 bg-surface-3" label="nerelevantné" />
        <Legend className="bg-warn" label="ručne" />
      </div>
    </>
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
