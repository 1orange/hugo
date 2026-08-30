"use client";

import { useState } from "react";
import type { DocumentActionResult } from "@/lib/documents/service";
import { useRouter } from "next/navigation";
import type { MonthDocumentView } from "@/lib/documents/view";
import { driveFileViewUrl, previewKindForMimeType } from "@/modules/file-preview";
import {
  confirmDocumentFormAction,
  dismissDocumentAction,
  saveDocumentNoteAction,
} from "../../actions";

type DocumentPanelProps = {
  companyId: number;
  monthKey: string;
  view: MonthDocumentView;
  folderFilters: string[];
};

export function DocumentPanel({
  companyId,
  monthKey,
  view,
  folderFilters,
}: DocumentPanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDriveFileId, setSelectedDriveFileId] = useState<string | null>(
    view.documents[0]?.driveFileId ?? null,
  );
  const folderFilter = view.folderFilter;
  const [dismissReason, setDismissReason] = useState("");

  const filteredDocuments = view.documents;

  const selectedDocument =
    filteredDocuments.find(
      (document) => document.driveFileId === selectedDriveFileId,
    ) ?? filteredDocuments[0] ?? null;

  function runAction(action: () => Promise<DocumentActionResult>) {
    setError(null);
    setPending(true);
    void action()
      .then((result) => {
        if (!result.ok) {
          setError(result.message ?? "Action failed.");
          return;
        }
        router.refresh();
      })
      .finally(() => {
        setPending(false);
      });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="document-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="remaining-count">
          {view.awaitingCount} document{view.awaitingCount === 1 ? "" : "s"} awaiting
          decision
        </p>
        {folderFilters.length > 0 ? (
          <form className="flex items-center gap-2 text-sm" method="get">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Folder</span>
              <select
                name="folder"
                className="rounded border border-border bg-background px-2 py-1"
                defaultValue={folderFilter ?? ""}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                data-testid="folder-filter"
              >
                <option value="">All folders</option>
                {folderFilters.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>
          </form>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-lg border border-border p-3" data-testid="documents-column">
          <h2 className="mb-2 text-sm font-medium">Documents</h2>
          {filteredDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents in this filter.</p>
          ) : (
            <ul className="space-y-2">
              {filteredDocuments.map((doc) => (
                <li
                  key={doc.driveFileId}
                  className={`rounded-md border p-2 text-sm ${
                    selectedDocument?.driveFileId === doc.driveFileId
                      ? "border-primary"
                      : "border-border/60"
                  }`}
                  data-testid="month-document-row"
                >
                  <div className="flex items-start gap-2">
                    <form action={confirmDocumentFormAction} className="flex items-start gap-2">
                      <input type="hidden" name="companyId" value={companyId} />
                      <input type="hidden" name="monthKey" value={monthKey} />
                      <input type="hidden" name="driveFileId" value={doc.driveFileId} />
                      <input
                        type="hidden"
                        name="confirmed"
                        value={doc.decision === "confirmed" ? "false" : "true"}
                        id={`document-confirmed-${doc.driveFileId}`}
                      />
                      <input
                        type="checkbox"
                        checked={doc.decision === "confirmed"}
                        disabled={view.readOnly || pending}
                        onChange={(event) => {
                          const hidden = globalThis.document.getElementById(
                            `document-confirmed-${doc.driveFileId}`,
                          ) as HTMLInputElement | null;
                          if (hidden) {
                            hidden.value = event.currentTarget.checked
                              ? "true"
                              : "false";
                          }
                          event.currentTarget.form?.requestSubmit();
                        }}
                        data-testid={`document-confirm-${doc.driveFileId}`}
                        aria-label={`Confirm ${doc.label}`}
                      />
                    </form>
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => setSelectedDriveFileId(doc.driveFileId)}
                    >
                      <p className="font-medium">{doc.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.folderSlot}
                        {doc.receiptKind
                          ? ` · ${doc.receiptKind === "cash" ? "Cash" : "Card"}`
                          : ""}
                      </p>
                      <p className="text-muted-foreground">{doc.amountDisplay}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.derivedStatus.hint}
                      </p>
                      {doc.decision === "not_relevant" ? (
                        <p className="text-xs text-muted-foreground">
                          Not relevant
                          {doc.notRelevantReason
                            ? `: ${doc.notRelevantReason}`
                            : ""}
                        </p>
                      ) : null}
                    </button>
                  </div>
                  {!view.readOnly && doc.decision !== "not_relevant" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs"
                        value={
                          selectedDocument?.driveFileId === doc.driveFileId
                            ? dismissReason
                            : ""
                        }
                        onChange={(event) => setDismissReason(event.target.value)}
                        placeholder="Dismiss reason (optional)"
                        data-testid={`dismiss-reason-${doc.driveFileId}`}
                      />
                      <button
                        type="button"
                        className="text-xs underline"
                        disabled={pending}
                        onClick={() =>
                          runAction(() =>
                            dismissDocumentAction({
                              companyId,
                              monthKey,
                              driveFileId: doc.driveFileId,
                              reason: dismissReason,
                            }),
                          )
                        }
                        data-testid={`document-dismiss-${doc.driveFileId}`}
                      >
                        Not relevant
                      </button>
                    </div>
                  ) : null}
                  {!view.readOnly ? (
                    <DocumentNoteEditor
                      driveFileId={doc.driveFileId}
                      initialNote={doc.note ?? ""}
                      disabled={pending}
                      onSave={(note) =>
                        runAction(() =>
                          saveDocumentNoteAction({
                            companyId,
                            monthKey,
                            driveFileId: doc.driveFileId,
                            note,
                          }),
                        )
                      }
                    />
                  ) : doc.note ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Note: {doc.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border p-3" data-testid="preview-pane">
          <h2 className="mb-2 text-sm font-medium">Preview</h2>
          {selectedDocument ? (
            <>
              {selectedDocument.extractionFailureReason ? (
                <p
                  className="mb-3 text-sm text-amber-800"
                  data-testid="extraction-failure-reason"
                >
                  {selectedDocument.extractionFailureReason}
                </p>
              ) : null}
              <PreviewPane
                driveFileId={selectedDocument.driveFileId}
                mimeType={selectedDocument.mimeType}
                name={selectedDocument.name}
              />
              {selectedDocument.hasExtractedData ? (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd>{selectedDocument.amountDisplay}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Receipt time</dt>
                    <dd>{selectedDocument.receiptDisplay}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No extracted fields. Read them off the preview and type them into
                  Omega directly for now — there is no field editor here yet.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a document.</p>
          )}
        </section>
      </div>

      {error ? (
        <p className="text-sm text-red-700" data-testid="document-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DocumentNoteEditor({
  driveFileId,
  initialNote,
  disabled,
  onSave,
}: {
  driveFileId: string;
  initialNote: string;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(initialNote);
  return (
    <div className="mt-2 flex gap-2">
      <input
        className="flex-1 rounded border border-border px-2 py-1 text-xs"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note"
        data-testid={`document-note-${driveFileId}`}
      />
      <button
        type="button"
        className="text-xs underline"
        disabled={disabled}
        onClick={() => onSave(note)}
      >
        Save
      </button>
    </div>
  );
}

function PreviewPane({
  driveFileId,
  mimeType,
  name,
}: {
  driveFileId: string;
  mimeType: string;
  name: string;
}) {
  const kind = previewKindForMimeType(mimeType);
  const previewUrl = `/api/files/${driveFileId}/preview`;

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={previewUrl}
        alt={name}
        className="max-h-[480px] w-full object-contain"
        data-testid="image-preview"
      />
    );
  }

  if (kind === "pdf") {
    return (
      <iframe
        title={name}
        src={previewUrl}
        className="h-[480px] w-full rounded border border-border/60"
        data-testid="pdf-preview"
      />
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Preview not supported for this file type.{" "}
      <a
        className="underline"
        href={driveFileViewUrl(driveFileId)}
        target="_blank"
        rel="noreferrer"
      >
        Open in Drive
      </a>
    </p>
  );
}
