"use client";

import type { DocumentListItem } from "@/lib/documents/view";
import { driveFileViewUrl, previewKindForMimeType } from "@/modules/file-preview";

/**
 * The preview is the widest column and runs the full height of the window.
 * She reads the document here and decides directly underneath it, so nothing
 * competes with it for space.
 */
export function DocumentStage({ document }: { document: DocumentListItem | null }) {
  if (!document) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-3 p-8">
        <p className="text-sm text-ink-3">Vyber doklad zo zoznamu vľavo.</p>
      </div>
    );
  }

  const previewUrl = `/api/files/${document.driveFileId}/preview`;
  const kind = previewKindForMimeType(document.mimeType);

  return (
    <>
      <div className="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-line bg-surface-2 px-3">
        <span className="truncate font-mono text-[12.5px] font-medium">
          {document.name}
        </span>
        <span className="hidden shrink-0 text-[11px] text-ink-3 md:inline">
          {document.folderSlot}
        </span>
        <div className="flex-1" />
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md border border-line-2 bg-surface px-2.5 py-[3px] text-[11.5px] text-ink-2 hover:border-accent hover:text-accent"
        >
          Na celú obrazovku
        </a>
        <a
          href={driveFileViewUrl(document.driveFileId)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md border border-line-2 bg-surface px-2.5 py-[3px] text-[11.5px] text-ink-2 hover:border-accent hover:text-accent"
        >
          Otvoriť v Drive
        </a>
      </div>

      <div
        className="flex flex-1 justify-center overflow-auto bg-surface-3 p-5 lg:min-h-0"
        data-testid="preview-pane"
      >
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={document.name}
            className="max-h-full w-auto max-w-full self-start object-contain shadow-[0_1px_1px_rgba(0,0,0,0.18),0_18px_40px_-22px_rgba(0,0,0,0.55)]"
            data-testid="image-preview"
          />
        ) : kind === "pdf" ? (
          <iframe
            title={document.name}
            src={previewUrl}
            className="h-full min-h-[520px] w-full max-w-[820px] border-0 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.18),0_18px_40px_-22px_rgba(0,0,0,0.55)]"
            data-testid="pdf-preview"
          />
        ) : (
          <div className="self-center text-center">
            <p className="text-sm text-ink-2">
              Náhľad pre tento typ súboru nie je podporovaný.
            </p>
            <a
              className="mt-2 inline-block text-sm text-accent underline"
              href={driveFileViewUrl(document.driveFileId)}
              target="_blank"
              rel="noreferrer"
            >
              Otvoriť v Drive
            </a>
          </div>
        )}
      </div>
    </>
  );
}
