"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DocumentActionResult } from "@/lib/documents/service";
import type { MonthDocumentView } from "@/lib/documents/view";
import {
  confirmDocumentAction,
  dismissDocumentAction,
  saveDocumentFieldsAction,
  lookupEkasaUidAction,
  reextractDocumentAction,
  saveDocumentNoteAction,
  setAdvanceSettlementAction,
  swapDocumentPartiesAction,
  takePartyFromProfileAction,
  takePartyFromRegisterAction,
} from "../../actions";
import { DecisionBar } from "./decision-bar";
import { isTypingTarget } from "./keyboard";
import { DocumentRail } from "./document-rail";
import { DocumentStage } from "./document-stage";
import { FieldsPanel, type DocumentFieldsInput } from "./fields-panel";
import type { PartySwapProvenance } from "@/modules/party-swap";
import { useMonthExtraction } from "./use-month-extraction";
import {
  documentBrowserNavigationKey,
  projectDocuments,
} from "@/modules/document-browser";

type DocumentWorkbenchProps = {
  companyId: number;
  monthKey: string;
  view: MonthDocumentView;
  autoAdvance: boolean;
  basePath: string;
};

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
  // The last decision, for a few seconds: "Potvrdené · X — Späť", even after the list moved on.
  const [toast, setToast] = useState<{ documentId: string; text: string } | null>(null);
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    view.documents[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const [subjectProblemsOnly, setSubjectProblemsOnly] = useState(false);
  const searchParams = useSearchParams();
  // The Omega export links here with ?doc=…: select that document once.
  const requestedDocumentId = searchParams.get("doc");

  // Search and the integrity filter narrow the folder's documents; sort order is the server's.
  const projection = useMemo(
    () =>
      projectDocuments(view.documents, {
        search,
        sortKey: view.sortKey,
        direction: view.sortDirection,
        homeCurrency: view.homeCurrency,
        subjectProblemsOnly,
      }),
    [search, subjectProblemsOnly, view.documents, view.homeCurrency, view.sortDirection, view.sortKey],
  );
  const documents = projection.documents;
  const selectedIndex = documents.findIndex(
    (document) => document.id === selectedDocumentId,
  );
  const selectedDocument =
    selectedIndex >= 0 ? documents[selectedIndex]! : documents[0] ?? null;

  // Parsing is kicked off in the background when the month is opened; the
  // screen follows the queue and renders again when a document is read.
  const liveExtraction = useMonthExtraction({
    companyId,
    monthKey,
    documents: view.documents,
  });

  useEffect(() => {
    if (requestedDocumentId) {
      setSearch("");
      setSelectedDocumentId(requestedDocumentId);
    }
  }, [requestedDocumentId]);

  // The request is served once. Left in the address, it would make a later link
  // to the same document a no-op after the accountant moved elsewhere.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("doc")) {
      return;
    }
    url.searchParams.delete("doc");
    window.history.replaceState(window.history.state, "", url);
  }, [selectedDocumentId]);

  // The filter is a URL round-trip, so the selection has to survive a list that
  // no longer contains it.
  useEffect(() => {
    if (
      selectedDocumentId &&
      !documents.some((document) => document.id === selectedDocumentId)
    ) {
      setSelectedDocumentId(documents[0]?.id ?? null);
    }
  }, [documents, selectedDocumentId]);

  const navigationSource = useRef(
    documentBrowserNavigationKey({
      folderFilter: view.folderFilter,
      sortKey: view.sortKey,
      sortDirection: view.sortDirection,
    }),
  );
  useEffect(() => {
    const nextNavigation = documentBrowserNavigationKey({
      folderFilter: view.folderFilter,
      sortKey: view.sortKey,
      sortDirection: view.sortDirection,
    });
    if (navigationSource.current !== nextNavigation) {
      navigationSource.current = nextNavigation;
      setSearch("");
    }
  }, [view.folderFilter, view.sortDirection, view.sortKey]);

  const [note, setNote] = useState(selectedDocument?.note ?? "");
  const noteSourceId = useRef<string | null>(selectedDocument?.id ?? null);

  useEffect(() => {
    if (noteSourceId.current !== (selectedDocument?.id ?? null)) {
      noteSourceId.current = selectedDocument?.id ?? null;
      setNote(selectedDocument?.note ?? "");
      setUidLookupMessage(null);
    }
  }, [selectedDocument]);

  const runAction = useCallback(
    (
      action: () => Promise<DocumentActionResult>,
      onDone?: () => void,
      onFailed?: () => void,
    ) => {
      setError(null);
      setPending(true);
      setSaveState("saving");
      void action()
        .then((result) => {
          if (!result.ok) {
            setError(result.message ?? "Akcia zlyhala.");
            setSaveState("idle");
            onFailed?.();
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
      setSelectedDocumentId(next.id);
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
      setSelectedDocumentId(documents[next]!.id);
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
          documentId: selectedDocument.id,
          confirmed: true,
        }),
      () => {
        setToast({ documentId: selectedDocument.id, text: `Potvrdené · ${selectedDocument.label}` });
        selectNextAwaiting();
      },
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
            documentId: selectedDocument.id,
            reason,
          }),
        () => {
          setToast({ documentId: selectedDocument.id, text: `Nerelevantné · ${selectedDocument.label}` });
          selectNextAwaiting();
        },
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
        documentId: selectedDocument.id,
        confirmed: false,
      }),
    );
  }, [companyId, monthKey, runAction, selectedDocument, view.readOnly]);

  const undoToast = useCallback(() => {
    if (!toast || view.readOnly) {
      return;
    }
    const documentId = toast.documentId;
    setToast(null);
    runAction(
      () => confirmDocumentAction({ companyId, monthKey, documentId, confirmed: false }),
      () => setSelectedDocumentId(documentId),
    );
  }, [companyId, monthKey, runAction, toast, view.readOnly]);

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
        documentId: selectedDocument.id,
        fields,
      }),
    );
  }

  function swapParties(fields: DocumentFieldsInput, partyProvenance: PartySwapProvenance) {
    if (!selectedDocument) {
      return;
    }
    // A refused swap reloads the document, so the panel drops what it showed.
    runAction(
      () =>
        swapDocumentPartiesAction({
          companyId,
          monthKey,
          documentId: selectedDocument.id,
          fields,
          partyProvenance,
        }),
      undefined,
      () => router.refresh(),
    );
  }

  function takeFromRegister(side: "supplier" | "customer") {
    if (!selectedDocument) {
      return;
    }
    // A refused take reloads the document, so the panel shows what the register now says is not there.
    runAction(
      () =>
        takePartyFromRegisterAction({
          companyId,
          monthKey,
          documentId: selectedDocument.id,
          side,
        }),
      undefined,
      () => router.refresh(),
    );
  }

  function takeFromProfile(side: "supplier" | "customer") {
    if (!selectedDocument) {
      return;
    }
    // A refused take reloads the document, as the register take does.
    runAction(
      () =>
        takePartyFromProfileAction({
          companyId,
          monthKey,
          documentId: selectedDocument.id,
          side,
        }),
      undefined,
      () => router.refresh(),
    );
  }

  function setAdvanceSettlement(settled: boolean) {
    if (!selectedDocument) {
      return;
    }
    runAction(
      () =>
        setAdvanceSettlementAction({
          companyId,
          monthKey,
          documentId: selectedDocument.id,
          settled,
        }),
      undefined,
      () => router.refresh(),
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
      documentId: selectedDocument.id,
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

  function reextract() {
    if (!selectedDocument?.canReextract) {
      return;
    }
    runAction(() =>
      reextractDocumentAction({
        companyId,
        monthKey,
        documentId: selectedDocument.id,
      }),
    );
  }

  function saveNote() {
    if (!selectedDocument || note === (selectedDocument.note ?? "")) {
      return;
    }
    runAction(() =>
      saveDocumentNoteAction({
        companyId,
        monthKey,
        documentId: selectedDocument.id,
        note,
      }),
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="document-panel">
      {error ? (
        <p
          className="shrink-0 border-b border-line bg-bad-soft px-4 py-2 text-[13px] text-bad sm:px-6"
          role="alert"
          data-testid="document-error"
        >
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_380px] xl:grid-cols-[340px_minmax(0,1fr)_420px]">
        <section
          className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:shadow-[inset_-1px_0_0_rgb(0_0_0/0.07)]"
          data-testid="documents-column"
          aria-label="Zoznam dokladov"
        >
          <DocumentRail
            documents={documents}
            folderFilters={view.folderFilters}
            folderFilter={view.folderFilter}
            totalCount={view.documents.length}
            search={search}
            onSearchChange={setSearch}
            sortKey={view.sortKey}
            sortDirection={view.sortDirection}
            readOnlyFiles={view.readOnlyFiles}
            selectedDocumentId={selectedDocument?.id ?? null}
            liveExtraction={liveExtraction}
            onSelect={(documentId) => {
              setDismissOpen(false);
              setSelectedDocumentId(documentId);
            }}
            basePath={basePath}
            subjectProblemCount={projection.subjectProblemCount}
            subjectProblemsOnly={subjectProblemsOnly}
            onSubjectProblemsOnlyChange={setSubjectProblemsOnly}
          />
        </section>

        <section
          className="relative flex min-h-[560px] flex-col border-b border-line lg:min-h-0 lg:border-b-0"
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
          {toast && !dismissOpen ? (
            <div
              role="status"
              className="rise-in absolute inset-x-0 bottom-[88px] z-10 mx-auto flex w-fit max-w-[calc(100%-32px)] items-center gap-3 rounded-xl bg-[rgb(29_29_31/0.9)] py-2 pr-2 pl-3.5 text-[13px] text-white shadow-[0_8px_24px_rgb(0_0_0/0.22)]"
              data-testid="decision-toast"
            >
              <span className="truncate">{toast.text}</span>
              <button
                type="button"
                onClick={undoToast}
                disabled={pending}
                className="press shrink-0 rounded-lg bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25 disabled:opacity-50"
              >
                Späť
              </button>
            </div>
          ) : null}
        </section>

        <section
          className="flex min-h-0 flex-col lg:shadow-[inset_1px_0_0_rgb(0_0_0/0.07)]"
          aria-label="Údaje dokladu"
        >
          <FieldsPanel
            document={selectedDocument}
            readOnly={view.readOnly}
            pending={pending}
            saveState={saveState}
            onSave={saveFields}
            onSwapParties={swapParties}
            onTakeFromRegister={takeFromRegister}
            onTakeFromProfile={takeFromProfile}
            onSetAdvanceSettlement={setAdvanceSettlement}
            note={note}
            onNoteChange={setNote}
            onNoteSave={saveNote}
            noteDirty={note !== (selectedDocument?.note ?? "")}
            onLookupUid={lookupUid}
            uidLookupMessage={uidLookupMessage}
            onReextract={reextract}
          />
        </section>
      </div>
    </div>
  );
}
