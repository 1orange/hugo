"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentActionResult } from "@/lib/documents/service";
import type { MonthDocumentView } from "@/lib/documents/view";
import {
  confirmDocumentAction,
  dismissDocumentAction,
  saveDocumentFieldsAction,
  lookupEkasaUidAction,
  saveDocumentNoteAction,
} from "../../actions";
import { DecisionBar } from "./decision-bar";
import { DocumentRail } from "./document-rail";
import { DocumentStage } from "./document-stage";
import { FieldsPanel, type DocumentFieldsInput } from "./fields-panel";

type DocumentWorkbenchProps = {
  companyId: number;
  monthKey: string;
  view: MonthDocumentView;
  autoAdvance: boolean;
  basePath: string;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Three panes filling the window: what's left, what she is reading, and what
 * the parser found. The decision lives under the preview (`DecisionBar`) rather
 * than on a list row, which is the whole point of the redesign.
 */
export function DocumentWorkbench({
  companyId,
  monthKey,
  view,
  autoAdvance,
  basePath,
}: DocumentWorkbenchProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [uidLookupMessage, setUidLookupMessage] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [selectedDriveFileId, setSelectedDriveFileId] = useState<string | null>(
    view.documents[0]?.driveFileId ?? null,
  );

  const documents = view.documents;
  const selectedIndex = documents.findIndex(
    (document) => document.driveFileId === selectedDriveFileId,
  );
  const selectedDocument =
    selectedIndex >= 0 ? documents[selectedIndex]! : documents[0] ?? null;

  /*
   * Parsing is kicked off in the background when the month is opened, so the
   * first render of a fresh month shows "čaká na spracovanie" for every eKasa
   * receipt. Nothing on the server can push the finished values down, so the
   * screen asks again until the parsers are done. The tick budget resets every
   * time the count moves, which stops a permanently stuck extraction (Drive
   * down mid-parse) from polling forever.
   */
  const pendingExtraction = view.pendingExtractionCount;
  const pollTicks = useRef(0);

  useEffect(() => {
    pollTicks.current = 0;
  }, [pendingExtraction]);

  useEffect(() => {
    if (pendingExtraction === 0) {
      return;
    }
    const timer = setInterval(() => {
      if (pollTicks.current >= 40) {
        clearInterval(timer);
        return;
      }
      pollTicks.current += 1;
      router.refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [pendingExtraction, router]);

  // The filter is a URL round-trip, so the selection has to survive a list that
  // no longer contains it.
  useEffect(() => {
    if (
      selectedDriveFileId &&
      !documents.some((document) => document.driveFileId === selectedDriveFileId)
    ) {
      setSelectedDriveFileId(documents[0]?.driveFileId ?? null);
    }
  }, [documents, selectedDriveFileId]);

  const [note, setNote] = useState(selectedDocument?.note ?? "");
  const noteSourceId = useRef<string | null>(selectedDocument?.driveFileId ?? null);

  useEffect(() => {
    if (noteSourceId.current !== (selectedDocument?.driveFileId ?? null)) {
      noteSourceId.current = selectedDocument?.driveFileId ?? null;
      setNote(selectedDocument?.note ?? "");
      setUidLookupMessage(null);
    }
  }, [selectedDocument]);

  const runAction = useCallback(
    (action: () => Promise<DocumentActionResult>, onDone?: () => void) => {
      setError(null);
      setPending(true);
      setSaveState("saving");
      void action()
        .then((result) => {
          if (!result.ok) {
            setError(result.message ?? "Akcia zlyhala.");
            setSaveState("idle");
            return;
          }
          setSaveState("saved");
          onDone?.();
          router.refresh();
        })
        .finally(() => {
          setPending(false);
        });
    },
    [router],
  );

  const selectNextAwaiting = useCallback(() => {
    if (!autoAdvance) {
      return;
    }
    const from = selectedIndex < 0 ? 0 : selectedIndex;
    const ordered = [
      ...documents.slice(from + 1),
      ...documents.slice(0, from),
    ];
    const next = ordered.find((document) => document.decision === null);
    if (next) {
      setSelectedDriveFileId(next.driveFileId);
    }
  }, [autoAdvance, documents, selectedIndex]);

  const step = useCallback(
    (delta: number) => {
      if (documents.length === 0) {
        return;
      }
      const from = selectedIndex < 0 ? 0 : selectedIndex;
      const next = Math.min(documents.length - 1, Math.max(0, from + delta));
      setDismissOpen(false);
      setSelectedDriveFileId(documents[next]!.driveFileId);
    },
    [documents, selectedIndex],
  );

  const confirm = useCallback(() => {
    if (!selectedDocument || view.readOnly || selectedDocument.decision !== null) {
      return;
    }
    setDismissOpen(false);
    runAction(
      () =>
        confirmDocumentAction({
          companyId,
          monthKey,
          driveFileId: selectedDocument.driveFileId,
          confirmed: true,
        }),
      selectNextAwaiting,
    );
  }, [companyId, monthKey, runAction, selectNextAwaiting, selectedDocument, view.readOnly]);

  const dismiss = useCallback(
    (reason: string) => {
      if (!selectedDocument || view.readOnly) {
        return;
      }
      setDismissOpen(false);
      runAction(
        () =>
          dismissDocumentAction({
            companyId,
            monthKey,
            driveFileId: selectedDocument.driveFileId,
            reason,
          }),
        selectNextAwaiting,
      );
    },
    [companyId, monthKey, runAction, selectNextAwaiting, selectedDocument, view.readOnly],
  );

  const undo = useCallback(() => {
    if (!selectedDocument || view.readOnly) {
      return;
    }
    runAction(() =>
      confirmDocumentAction({
        companyId,
        monthKey,
        driveFileId: selectedDocument.driveFileId,
        confirmed: false,
      }),
    );
  }, [companyId, monthKey, runAction, selectedDocument, view.readOnly]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        confirm();
      } else if (key === "n") {
        event.preventDefault();
        if (!view.readOnly && selectedDocument?.decision === null) {
          setDismissOpen(true);
        }
      } else if (key === "j") {
        event.preventDefault();
        step(1);
      } else if (key === "k") {
        event.preventDefault();
        step(-1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirm, selectedDocument, step, view.readOnly]);

  function saveFields(fields: DocumentFieldsInput) {
    if (!selectedDocument) {
      return;
    }
    runAction(() =>
      saveDocumentFieldsAction({
        companyId,
        monthKey,
        driveFileId: selectedDocument.driveFileId,
        fields,
      }),
    );
  }

  function lookupUid(uid: string) {
    if (!selectedDocument) {
      return;
    }
    setError(null);
    setUidLookupMessage(null);
    setPending(true);
    void lookupEkasaUidAction({
      companyId,
      monthKey,
      driveFileId: selectedDocument.driveFileId,
      uid,
    })
      .then((result) => {
        if (!result.ok) {
          setUidLookupMessage(result.message);
          return;
        }
        if (!result.found) {
          setUidLookupMessage(result.message);
          router.refresh();
          return;
        }
        router.refresh();
      })
      .finally(() => {
        setPending(false);
      });
  }

  function saveNote() {
    if (!selectedDocument || note === (selectedDocument.note ?? "")) {
      return;
    }
    runAction(() =>
      saveDocumentNoteAction({
        companyId,
        monthKey,
        driveFileId: selectedDocument.driveFileId,
        note,
      }),
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="document-panel">
      {error ? (
        <p
          className="shrink-0 border-b border-line bg-bad-soft px-3.5 py-2 text-[12.5px] text-bad"
          role="alert"
          data-testid="document-error"
        >
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_320px] xl:grid-cols-[264px_minmax(0,1fr)_340px]">
        <section
          className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r"
          data-testid="documents-column"
          aria-label="Zoznam dokladov"
        >
          <DocumentRail
            documents={documents}
            folderFilters={view.folderFilters}
            folderFilter={view.folderFilter}
            totalCount={view.totalCount}
            readOnlyFiles={view.readOnlyFiles}
            selectedDriveFileId={selectedDocument?.driveFileId ?? null}
            onSelect={(driveFileId) => {
              setDismissOpen(false);
              setSelectedDriveFileId(driveFileId);
            }}
            basePath={basePath}
          />
        </section>

        <section
          className="flex min-h-0 flex-col border-b border-line lg:border-b-0"
          aria-label="Náhľad dokladu"
        >
          <DocumentStage document={selectedDocument} />
          <DecisionBar
            document={selectedDocument}
            awaitingCount={view.awaitingCount}
            readOnly={view.readOnly}
            pending={pending}
            onConfirm={confirm}
            onDismiss={dismiss}
            onUndo={undo}
            onStep={step}
            dismissOpen={dismissOpen}
            onOpenDismiss={() => setDismissOpen(true)}
            onCloseDismiss={() => setDismissOpen(false)}
          />
        </section>

        <section
          className="flex min-h-0 flex-col lg:border-l lg:border-line"
          aria-label="Údaje dokladu"
        >
          <FieldsPanel
            document={selectedDocument}
            readOnly={view.readOnly}
            pending={pending}
            saveState={saveState}
            onSave={saveFields}
            note={note}
            onNoteChange={setNote}
            onNoteSave={saveNote}
            noteDirty={note !== (selectedDocument?.note ?? "")}
            onLookupUid={lookupUid}
            uidLookupMessage={uidLookupMessage}
          />
        </section>
      </div>
    </div>
  );
}
