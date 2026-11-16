"use client";

import { ExternalLink, Maximize2 } from "lucide-react";
import type { DocumentListItem } from "@/lib/documents/view";
import { driveFileViewUrl, previewKindForMimeType } from "@/modules/file-preview";

/**
 * The preview is the widest column and runs the full height of the window.
 * Its two actions float over its corner and the decision floats over its foot,
 * so nothing takes a strip of its own.
 */
export function DocumentStage({ document }: { document: DocumentListItem | null }) {
  if (!document) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#e8e9ec] p-8">
        <p className="text-[14px] text-ink-3">Vyber doklad zo zoznamu vľavo.</p>
      </div>
    );
  }

  const previewUrl = `/api/files/${document.driveFileId}/preview`;
  const kind = previewKindForMimeType(document.mimeType);

  const floating =
    "glass press grid size-8 place-items-center rounded-[9px] text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.06)] hover:text-ink";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="absolute top-3 right-3.5 z-10 flex gap-1.5">
        <a href={previewUrl} target="_blank" rel="noreferrer" aria-label="Na celú obrazovku" title="Na celú obrazovku" className={floating}>
          <Maximize2 aria-hidden className="size-[15px]" strokeWidth={2} />
        </a>
        <a
          href={driveFileViewUrl(document.driveFileId)}
          target="_blank"
          rel="noreferrer"
          aria-label="Otvoriť v Drive"
          title="Otvoriť v Drive"
          className={floating}
        >
          <ExternalLink aria-hidden className="size-[15px]" strokeWidth={2} />
        </a>
      </div>

      <div
        className="flex flex-1 justify-center overflow-auto bg-[#e8e9ec] px-5 pt-5 pb-28 lg:min-h-0"
        data-testid="preview-pane"
      >
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={document.name}
            className="h-auto max-w-full self-start rounded-[4px] object-contain shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_28px_rgb(0_0_0/0.1)]"
            data-testid="image-preview"
          />
        ) : kind === "pdf" ? (
          <iframe
            title={document.name}
            src={previewUrl}
            className="h-full min-h-[520px] w-full max-w-[820px] rounded-[4px] border-0 bg-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_28px_rgb(0_0_0/0.1)]"
            data-testid="pdf-preview"
          />
        ) : (
          <div className="self-center text-center">
            <p className="text-[15px] font-semibold">Náhľad nie je k dispozícii</p>
            <p className="mt-1 text-[13px] text-ink-3">Tento typ súboru sa nedá zobraziť v aplikácii.</p>
            <a
              className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline"
              href={driveFileViewUrl(document.driveFileId)}
              target="_blank"
              rel="noreferrer"
            >
              Otvoriť v Drive
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
