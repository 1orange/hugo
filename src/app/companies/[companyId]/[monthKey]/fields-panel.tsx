"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentListItem } from "@/lib/documents/view";
import {
  cashRoundingOfFields,
  checkArithmeticWarnings,
  fieldCheckState,
  resolvePartyRoles,
  type FieldCheckState,
  type FieldProvenance,
  type FieldProvenanceMap,
} from "@/modules/document-fields";
import { deriveVat } from "@/modules/vat-derivation";
import { extractionFailureMessage } from "@/modules/extraction-failure";
import { formatSkMoney } from "@/modules/format-sk";
import { validateEkasaUidInput } from "@/modules/ekasa-identifiers";
import { rebaseDraft } from "@/modules/draft-rebase";
import {
  confirmEditedPartyProvenance,
  partySideSource,
  pickPartyProvenance,
  swapParties,
  withoutPartyChecks,
  type PartySwapProvenance,
} from "@/modules/party-swap";
import {
  checkDocumentParties,
  offersRegisterTakeover,
  partyIdentityKey,
  subjectFindingMessage,
  verdictLabel,
  type IntegrityVerdict,
  type SubjectCheck,
} from "@/modules/subject-integrity";
import { isTypingTarget } from "./keyboard";

export type VatRecapRowInput = {
  rateLiteral: string;
  baseLiteral: string;
  vatLiteral: string;
};

export type DocumentFieldsInput = {
  exportSection: "" | "T01" | "T00";
  supplierName: string;
  ico: string;
  dic: string;
  icDph: string;
  customerName: string;
  customerIco: string;
  customerDic: string;
  customerIcDph: string;
  documentNumber: string;
  variableSymbol: string;
  issueDateRaw: string;
  taxableSupplyDateRaw: string;
  dueDateRaw: string;
  receiptNumber: string;
  receiptTimestampRaw: string;
  currency: string;
  amountLiteral: string;
  recapBaseLiteral: string;
  recapVatLiteral: string;
  vatRecap: VatRecapRowInput[];
};

type FieldsPanelProps = {
  document: DocumentListItem | null;
  readOnly: boolean;
  pending: boolean;
  saveState: "idle" | "saving" | "saved";
  onSave: (fields: DocumentFieldsInput) => void;
  /** Saves the parties after a swap, with the provenance they carry. */
  onSwapParties: (fields: DocumentFieldsInput, partyProvenance: PartySwapProvenance) => void;
  /** *Prevziať z registra* for one flagged party: its legal name, DIČ and IČ DPH from the register. */
  onTakeFromRegister: (side: "supplier" | "customer") => void;
  /** Her decision whether the invoice is settled by an advance (true) or not (false). */
  onSetAdvanceSettlement: (settled: boolean) => void;
  note: string;
  onNoteChange: (note: string) => void;
  onNoteSave: () => void;
  noteDirty: boolean;
  onLookupUid: (uid: string) => void;
  uidLookupMessage: string | null;
  /** Read the file again (document.canReextract). */
  onReextract: () => void;
};

type SwappedParties = {
  /** The swapped draft, which is what the panel shows until the document reloads. */
  shown: DocumentFieldsInput;
  provenance: FieldProvenanceMap;
  rolesFlagged: boolean;
  missingProfile: boolean;
};

function draftFrom(document: DocumentListItem): DocumentFieldsInput {
  const { fields, exportSectionOverride } = document.fieldEditor;
  return {
    exportSection: exportSectionOverride ?? "",
    supplierName: fields.supplierName,
    ico: fields.ico,
    dic: fields.dic,
    icDph: fields.icDph,
    customerName: fields.customerName,
    customerIco: fields.customerIco,
    customerDic: fields.customerDic,
    customerIcDph: fields.customerIcDph,
    documentNumber: fields.documentNumber,
    variableSymbol: fields.variableSymbol,
    issueDateRaw: fields.issueDateRaw,
    taxableSupplyDateRaw: fields.taxableSupplyDateRaw,
    dueDateRaw: fields.dueDateRaw,
    receiptNumber: fields.receiptNumber,
    receiptTimestampRaw: fields.receiptTimestampRaw,
    currency: fields.currency,
    amountLiteral: fields.amountLiteral,
    recapBaseLiteral: fields.recapBaseLiteral,
    recapVatLiteral: fields.recapVatLiteral,
    vatRecap:
      fields.vatRecap.length > 0
        ? fields.vatRecap.map((row) => ({
            rateLiteral: row.rateLiteral,
            baseLiteral: row.baseLiteral,
            vatLiteral: row.vatLiteral,
          }))
        : [{ rateLiteral: "", baseLiteral: "", vatLiteral: "" }],
  };
}

// Allow intermediate input (empty or a trailing separator) while typing.
const DECIMAL_INPUT_PATTERN = /^-?\d{0,10}(?:[.,]\d{0,2})?$/;

/** Empty VAT rows are local placeholders, omitted by the server on save. */
function savedSnapshot(draft: DocumentFieldsInput): DocumentFieldsInput {
  const rows = draft.vatRecap.filter((row) =>
    row.rateLiteral.trim() || row.baseLiteral.trim() || row.vatLiteral.trim(),
  );
  return {
    ...draft,
    vatRecap: rows.length ? rows : [{ rateLiteral: "", baseLiteral: "", vatLiteral: "" }],
  };
}

/** Signed, in the same dot-decimal form as the amount fields beside it. */
function formatCashRounding(cents: number, currency: string): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${(Math.abs(cents) / 100).toFixed(2)} ${currency}`;
}

function parseDraftCents(literal: string): number | null {
  const trimmed = literal.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^(-?)(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const whole = match[2]!;
  const fraction = match[3] ?? "";
  const centsFromFraction =
    fraction.length === 0 ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
  return (match[1] === "-" ? -1 : 1) * (Number(whole) * 100 + centsFromFraction);
}

/** The row's tone: a flagged value is tinted, an empty one simply shows "Doplniť". */
function fieldStateClass(state: FieldCheckState): string {
  if (state === "flagged") {
    return "bg-[#fffaf0]";
  }
  return "";
}

const GROUP = "overflow-hidden rounded-xl bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.04)]";
const GROUP_HEADING = "flex items-baseline justify-between gap-2 px-1 pb-1.5";
const NOTICE = "rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn-strong";

export function FieldsPanel({
  document,
  readOnly,
  pending,
  saveState,
  onSave,
  onSwapParties,
  onTakeFromRegister,
  onSetAdvanceSettlement,
  note,
  onNoteChange,
  onNoteSave,
  noteDirty,
  onLookupUid,
  uidLookupMessage,
  onReextract,
}: FieldsPanelProps) {
  const [uidDraft, setUidDraft] = useState("");
  const [uidValidationMessage, setUidValidationMessage] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<DocumentFieldsInput | null>(
    document ? draftFrom(document) : null,
  );
  const [saved, setSaved] = useState<DocumentFieldsInput | null>(
    document ? draftFrom(document) : null,
  );
  const [liveVatWarnings, setLiveVatWarnings] = useState<string[]>([]);
  // What the panel shows after a swap, until the document is reloaded.
  const [swappedParties, setSwappedParties] = useState<SwappedParties | null>(null);
  const swapRef = useRef<() => void>(() => undefined);

  const documentId = document?.id ?? null;
  const loadedDocumentId = useRef<string | null>(documentId);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const manualOverridesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const next = document ? draftFrom(document) : null;
    setSwappedParties(null);
    if (loadedDocumentId.current !== documentId) {
      // Another document: start from what it holds.
      loadedDocumentId.current = documentId;
      manualOverridesRef.current.clear();
      setDraft(next);
      setSaved(next);
      setUidDraft(document?.typedEkasaUid ?? "");
      setUidValidationMessage(null);
      setLiveVatWarnings([]);
      return;
    }
    // The same document refreshed — a background extraction finished, or a
    // save came back. Keep whatever she is typing and has not saved yet.
    const previous = savedRef.current;
    setDraft((current) =>
      current && previous && next
        ? rebaseDraft({ saved: previous, draft: current, incoming: next })
        : next,
    );
    setSaved(next);
    setUidDraft((current) => current || (document?.typedEkasaUid ?? ""));
  }, [documentId, document]);

  useEffect(() => {
    if (!document || !draft || readOnly) {
      return;
    }
    const parsedRows = draft.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      baseCents: parseDraftCents(row.baseLiteral) ?? 0,
      vatLiteral: row.vatLiteral,
      vatCents: parseDraftCents(row.vatLiteral) ?? 0,
    }));
    const result = deriveVat({
      amount: {
        literal: draft.amountLiteral,
        cents: parseDraftCents(draft.amountLiteral),
        provenance: document.fieldEditor.provenance.amountLiteral,
      },
      recapBase: {
        literal: draft.recapBaseLiteral,
        cents: parseDraftCents(draft.recapBaseLiteral),
        provenance: document.fieldEditor.provenance.recapBaseLiteral,
      },
      recapVat: {
        literal: draft.recapVatLiteral,
        cents: parseDraftCents(draft.recapVatLiteral),
        provenance: document.fieldEditor.provenance.recapVatLiteral,
      },
      vatRecap:
        document.fieldEditor.provenance.vatRecap === "derived" &&
        !manualOverridesRef.current.has("vatRecap") &&
        !manualOverridesRef.current.has("recapVatLiteral")
          ? []
          : parsedRows,
      vatRecapProvenance: document.fieldEditor.provenance.vatRecap,
      folderSlot: document.folderSlot,
      supplierIcDph: draft.icDph,
      profileCountry: document.fieldEditor.profileCountry,
      advanceSettled: document.fieldEditor.advanceSettled === true,
    });
    setLiveVatWarnings(result.warnings);
    const next = { ...draft };
    let changed = false;
    const canDerive = (key: keyof typeof document.fieldEditor.provenance) =>
      document.fieldEditor.provenance[key] === "derived" ||
      document.fieldEditor.provenance[key] === "empty";
    if (
      canDerive("recapBaseLiteral") &&
      !manualOverridesRef.current.has("recapBaseLiteral") &&
      result.recapBase.provenance === "derived" &&
      result.recapBase.literal !== draft.recapBaseLiteral
    ) {
      next.recapBaseLiteral = result.recapBase.literal;
      changed = true;
    }
    if (
      canDerive("recapVatLiteral") &&
      !manualOverridesRef.current.has("recapVatLiteral") &&
      result.recapVat.provenance === "derived" &&
      result.recapVat.literal !== draft.recapVatLiteral
    ) {
      next.recapVatLiteral = result.recapVat.literal;
      changed = true;
    }
    if (
      (document.fieldEditor.provenance.vatRecap === "derived" ||
        document.fieldEditor.provenance.vatRecap === "empty") &&
      !manualOverridesRef.current.has("vatRecap") &&
      result.vatRecapProvenance === "derived" &&
      JSON.stringify(result.vatRecap) !== JSON.stringify(parsedRows)
    ) {
      next.vatRecap = result.vatRecap.map((row) => ({
        rateLiteral: row.rateLiteral,
        baseLiteral: row.baseLiteral,
        vatLiteral: row.vatLiteral,
      }));
      changed = true;
    }
    if (changed) {
      setDraft(next);
    }
  }, [document, draft, readOnly]);

  const dirty = useMemo(
    () =>
      JSON.stringify(draft ? savedSnapshot(draft) : null) !==
      JSON.stringify(saved ? savedSnapshot(saved) : null),
    [draft, saved],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== "x") {
        return;
      }
      event.preventDefault();
      swapRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!document || !draft) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-ink-3">Žiadny doklad.</p>
      </div>
    );
  }

  // After a swap the panel shows the swapped badges and roles at once; the
  // saved document catches up when it is reloaded.
  const shown = swappedParties
    ? {
        ...document.fieldEditor,
        provenance: swappedParties.provenance,
        rolesFlagged: swappedParties.rolesFlagged,
        missingProfile: swappedParties.missingProfile,
        fieldChecks: withoutPartyChecks(document.fieldEditor.fieldChecks),
      }
    : document.fieldEditor;
  const {
    provenance,
    fieldChecks,
    docTypeHint,
    nonEurCurrency,
    homeCurrency,
    rolesFlagged,
    missingProfile,
    exportSectionResolved,
    vatWarnings,
  } = shown;
  // Like the fields, the parties and the settlement stay editable on a decided
  // document, so a misread can be mended after the decision (2026-11-12).
  const swapLocked = readOnly || pending;
  // The settlement in effect: the detected one, or hers over it. Null when not settled.
  const advance = shown.advanceSettlement ?? null;
  const advanceAvailable = document.fieldEditor.advanceSettlementAvailable === true;
  const advanceLocked = readOnly || pending;
  const advanceTitle = readOnly ? "Mesiac je uzavretý — vyúčtovanie sa nedá meniť" : undefined;

  const roleFieldFlagged = rolesFlagged || missingProfile;
  const isCreditNote = docTypeHint === "credit_note";

  function resolveState(key: keyof typeof provenance, extraFlagged = false): FieldCheckState {
    const prov = provenance[key];
    if (prov === "confirmed") {
      return "correct";
    }
    const fromChecks =
      key === "vatRecap" ? fieldChecks?.vatRecap : fieldChecks?.[key as keyof typeof fieldChecks];
    if (fromChecks && prov === "extracted") {
      if (fromChecks === "empty") {
        return "empty";
      }
      if (fromChecks === "flagged" || extraFlagged) {
        return "flagged";
      }
      return "correct";
    }
    if (key === "vatRecap") {
      return fieldCheckState(provenance.vatRecap, extraFlagged);
    }
    return fieldCheckState(provenance[key], extraFlagged);
  }

  const draftFieldsForChecks = {
    ...document.fieldEditor.fields,
    amountLiteral: draft.amountLiteral,
    recapBaseLiteral: draft.recapBaseLiteral,
    recapVatLiteral: draft.recapVatLiteral,
    amountCents: parseDraftCents(draft.amountLiteral),
    recapBaseCents: parseDraftCents(draft.recapBaseLiteral),
    recapVatCents: parseDraftCents(draft.recapVatLiteral),
    vatRecap: draft.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      baseCents: parseDraftCents(row.baseLiteral) ?? 0,
      vatLiteral: row.vatLiteral,
      vatCents: parseDraftCents(row.vatLiteral) ?? 0,
    })),
  };

  const arithmeticWarnings = [
    ...(vatWarnings ?? []),
    ...liveVatWarnings,
    ...checkArithmeticWarnings(draftFieldsForChecks),
  ].filter((warning, index, warnings) => warnings.indexOf(warning) === index);
  const cashRounding = cashRoundingOfFields(draftFieldsForChecks);
  const amountCheckOk = fieldChecks?.amountLiteral === "correct";
  const vatCheckOk = fieldChecks?.vatRecap === "correct";
  const arithmeticFlagged =
    !isCreditNote &&
    arithmeticWarnings.length > 0 &&
    !(amountCheckOk && (draftFieldsForChecks.vatRecap.length === 0 || vatCheckOk));
  // The rates' line under their heading: whether they add up with the totals, as she types.
  const vatRowsFilled = draft.vatRecap.some((row) => row.baseLiteral.trim() || row.vatLiteral.trim());
  const vatCheck =
    vatRowsFilled && draft.amountLiteral.trim()
      ? arithmeticWarnings.length === 0
        ? { ok: true, text: "✓ Sedí s celkom" }
        : { ok: false, text: "Nesedí — pozri Sumy" }
      : null;

  function patch(next: Partial<DocumentFieldsInput>, manuallyEdited: string[] = Object.keys(next)) {
    for (const key of manuallyEdited) {
      manualOverridesRef.current.add(key);
    }
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function commit() {
    if (readOnly || !dirty || !draft) {
      return;
    }
    setSaved(savedSnapshot(draft));
    onSave(draft);
  }

  function updateVatRow(index: number, change: Partial<VatRecapRowInput>) {
    patch({
      vatRecap: draft!.vatRecap.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...change } : row,
      ),
    });
  }

  function commitVatRows(rows: VatRecapRowInput[]) {
    manualOverridesRef.current.add("vatRecap");
    const next = { ...draft!, vatRecap: rows };
    setDraft(next);
    if (!readOnly) {
      setSaved(savedSnapshot(next));
      onSave(next);
    }
  }

  function requestSwap() {
    if (swapLocked || !draft) {
      return;
    }
    // Her edits are judged against what the panel last showed: the swapped
    // values after a swap, otherwise the document as loaded.
    const effective = confirmEditedPartyProvenance(
      draft,
      swappedParties?.shown ?? document!.fieldEditor.fields,
      provenance,
    );
    const swapped = swapParties(draft, effective);
    const roles = resolvePartyRoles({
      folderSlot: document!.folderSlot,
      profile: document!.fieldEditor.roleContext?.profile ?? null,
      enabled: document!.fieldEditor.roleContext?.enrichmentEnabled ?? true,
      labeled: true,
      supplier: partySideSource(swapped.draft, swapped.provenance, "supplier"),
      customer: partySideSource(swapped.draft, swapped.provenance, "customer"),
      directory: document!.fieldEditor.roleContext?.directory ?? null,
    });
    setDraft(swapped.draft);
    setSaved(savedSnapshot(swapped.draft));
    setSwappedParties({
      shown: swapped.draft,
      provenance: swapped.provenance as FieldProvenanceMap,
      rolesFlagged: roles.rolesFlagged,
      missingProfile: roles.missingProfile,
    });
    onSwapParties(swapped.draft, pickPartyProvenance(swapped.provenance));
  }
  swapRef.current = requestSwap;

  const swapTitle = readOnly ? "Mesiac je uzavretý — strany sa nedajú meniť" : "Vymeniť strany (X)";

  // The worker's verdict while the draft holds the values it was judged for (ADR 0022);
  // otherwise judged here, offline, on every keystroke and swap.
  const profileIdentity = document.fieldEditor.roleContext?.profile ?? null;
  const integrity =
    document.fieldEditor.partyIntegrityStored &&
    partyIdentityKey(draft, profileIdentity) === document.fieldEditor.partyIntegrityIdentity
      ? document.fieldEditor.partyIntegrity
      : checkDocumentParties({
          folderSlot: document.folderSlot,
          fields: draft,
          profile: profileIdentity,
        });

  const decisionPill =
    document.decision === "confirmed"
      ? { label: "Potvrdené", className: "bg-good-soft text-good" }
      : document.decision === "not_relevant"
        ? { label: "Nerelevantné", className: "bg-fill text-ink-2" }
        : document.derivedStatus?.kind === "manual-entry"
          ? { label: "Vyplniť ručne", className: "bg-warn-soft text-warn" }
          : { label: "Čaká", className: "bg-accent-soft text-accent" };

  return (
    <>
      <div
        className="relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-ground px-4 pt-4 pb-10 [&>*]:shrink-0"
        data-testid="document-field-editor"
      >
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] leading-tight font-bold tracking-[-0.015em] [overflow-wrap:anywhere]">
              {draft.supplierName.trim() || document.label || document.name}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
              <span>{document.receiptKind === "receipt" ? "Bloček" : "Doklad"}</span>
              <span aria-hidden>·</span>
              <span>{document.folderSlot}</span>
              {document.extractionSource ? (
                <>
                  <span aria-hidden>·</span>
                  <span data-testid="extraction-source-badge">
                    {document.extractionSource === "lookup"
                      ? "Finančná správa"
                      : document.extractionSource === "text-layer"
                        ? "Text PDF"
                        : document.extractionSource === "model"
                          ? "Model"
                          : document.extractionSource === "ocr"
                            ? "OCR"
                            : document.extractionSource === "isdoc"
                              ? "ISDOC"
                              : document.extractionSource === "mol"
                                ? "XML MOL"
                                : "Text PDF"}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <span className={`mt-1 shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${decisionPill.className}`}>
            {decisionPill.label}
          </span>
        </div>

        {document.canReextract ? (
          <div className="-mt-1.5">
            <button
              type="button"
              className="press rounded-lg px-2 py-1 text-[12.5px] font-semibold text-accent hover:bg-fill disabled:opacity-50"
              disabled={pending}
              onClick={onReextract}
              title="Prečíta súbor znova — po úspechu nahradí staré polia, pri chybe ich zachová."
              data-testid="reextract-document"
            >
              Načítať znova
            </button>
          </div>
        ) : null}

        {document.decision === "not_relevant" ? (
          <div className="rounded-xl bg-surface px-3.5 py-2.5 text-[13px] shadow-[0_0_0_1px_rgb(0_0_0/0.04)]" data-testid="not-relevant-reason">
            <p className="font-semibold">Nerelevantné — do Omegy nejde</p>
            <p className="mt-0.5 text-ink-2">
              {document.notRelevantReason ? `Dôvod: ${document.notRelevantReason}` : "Dôvod nebol uvedený."}
            </p>
          </div>
        ) : null}

        {document.receiptOfFile ? (
          <p className="rounded-xl bg-surface px-3.5 py-2 text-[13px] text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.04)]" data-testid="receipt-of-file">
            Bloček {document.receiptOfFile.index} z {document.receiptOfFile.count} v tomto súbore
          </p>
        ) : null}
        {document.sameReceiptAs.length > 0 ? (
          <p className={NOTICE} data-testid="same-receipt-as">
            Rovnaký bloček je aj v{" "}
            {document.sameReceiptAs
              .map((other) => `${other.fileName} (${other.monthKey.replace("_", "/")})`)
              .join(", ")}
            . Do Omegy pôjde len raz — druhý označ ako nerelevantný.
          </p>
        ) : null}

        <div className={GROUP}>
          <label className="flex items-center gap-3 px-3.5 py-2.5" htmlFor="export-section">
            <span className="flex-1 text-[14px]">Sekcia v Omege</span>
            <select
              id="export-section"
              className="max-w-[60%] bg-transparent text-right text-[14px] font-medium text-accent outline-none disabled:text-ink-2"
              disabled={readOnly || pending}
              value={draft.exportSection}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "" || value === "T01" || value === "T00") {
                  patch({ exportSection: value });
                }
              }}
              onBlur={commit}
              data-testid="export-section-select"
            >
              <option value="">Automaticky ({exportSectionResolved === "T01" ? "T01" : "T00"})</option>
              <option value="T01">Fakturácia (T01)</option>
              <option value="T00">EUD bločky (T00)</option>
            </select>
          </label>
        </div>
        {document.outsideEkasa ? (
          <p
            className="rounded-xl bg-surface px-3.5 py-2.5 text-[13px] text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.04)]"
            data-testid="outside-ekasa"
          >
            Doklad nie je z eKasa (parkovací automat, lístok, faktúra): nemá
            UID, údaje sú prečítané z dokladu.
          </p>
        ) : null}
        {document.showUidBox ? (
          <fieldset className={`${GROUP} px-3.5 py-3`} data-testid="ekasa-uid-box">
            <legend className="sr-only">UID eBločku</legend>
            <p className="eyebrow">UID eBločku</p>
            <p className="mt-0.5 mb-2 text-[12.5px] text-ink-3">
              Ak QR kód nejde prečítať, zadaj 34-znakový UID z bločku. Údaje
              načítame z Finančnej správy.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={uidDraft}
                onChange={(event) => {
                  setUidDraft(event.target.value);
                  setUidValidationMessage(null);
                }}
                placeholder="O-… alebo V-…"
                aria-label="UID eBločku"
                data-testid="ekasa-uid-input"
                disabled={pending}
                className="min-w-0 flex-1 rounded-lg bg-fill px-2.5 py-2 font-mono text-[13px] uppercase outline-none focus:bg-surface focus:shadow-[0_0_0_2px_rgb(43_93_114/0.45)]"
              />
              <button
                type="button"
                disabled={pending || !uidDraft.trim()}
                data-testid="ekasa-uid-submit"
                onClick={() => {
                  const validated = validateEkasaUidInput(uidDraft);
                  if (!validated.ok) {
                    setUidValidationMessage(validated.message);
                    return;
                  }
                  setUidValidationMessage(null);
                  onLookupUid(validated.uid);
                }}
                className="press shrink-0 rounded-lg bg-accent-soft px-3.5 py-2 text-[13px] font-semibold text-accent disabled:opacity-40"
              >
                Načítať
              </button>
            </div>
            {uidValidationMessage ? (
              <p
                className="mt-2 text-[12px] text-bad"
                role="alert"
                data-testid="ekasa-uid-validation-error"
              >
                {uidValidationMessage}
              </p>
            ) : null}
            {uidLookupMessage ? (
              <p
                className="mt-2 text-[12px] text-warn"
                role="status"
                data-testid="ekasa-uid-lookup-message"
              >
                {uidLookupMessage}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {docTypeHint === "proforma" ? (
          <p
            className={NOTICE}
            data-testid="proforma-hint"
          >
            Vyzerá to ako zálohová faktúra — stále rozhodni, či ju zaúčtuješ.
          </p>
        ) : null}

        {document.extractionFailureReason ? (
          <p
            className={NOTICE}
            data-testid="extraction-failure-reason"
          >
            {extractionFailureMessage(document.extractionFailureReason)}
          </p>
        ) : null}

        {missingProfile ? (
          <p
            className={NOTICE}
            data-testid="missing-profile-warning"
          >
            Chýba profil firmy — strany dokladu sa nedajú priradiť.
          </p>
        ) : null}

        {rolesFlagged && !missingProfile ? (
          <p
            className={NOTICE}
            data-testid="party-roles-flagged"
          >
            Ani jedna strana nezodpovedá profilu klienta — skontroluj, či je doklad v správnom
            priečinku.
          </p>
        ) : null}

        {nonEurCurrency ? (
          <p
            className={NOTICE}
            data-testid="non-eur-warning"
          >
            Mena je {draft.currency}. Kurz sa neprepočítava — zadaj sumu v {homeCurrency}, ktorú
            chceš zaúčtovať.
          </p>
        ) : null}

        <fieldset>
          <legend className="sr-only">Dodávateľ</legend>
          <div className={GROUP_HEADING}>
            <span className="eyebrow">Dodávateľ</span>
            <IntegrityBadge check={integrity.supplier} testId="party-integrity-supplier" />
          </div>
          <div className={GROUP}>
            <Field
              label="Názov"
              value={draft.supplierName}
              provenance={provenance.supplierName}
              state={resolveState("supplierName", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ supplierName: value })}
              onCommit={commit}
              testId="field-supplier-name"
              wide
            />
            <Field
              label="IČO"
              value={draft.ico}
              provenance={provenance.ico}
              state={resolveState("ico", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ ico: value })}
              onCommit={commit}
              testId="field-ico"
            />
            <Field
              label="DIČ"
              value={draft.dic}
              provenance={provenance.dic}
              state={resolveState("dic")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ dic: value })}
              onCommit={commit}
              testId="field-dic"
            />
            <Field
              label="IČ DPH"
              value={draft.icDph}
              provenance={provenance.icDph}
              state={resolveState("icDph", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ icDph: value })}
              onCommit={commit}
              testId="field-ic-dph"
              wide
            />
          </div>
          <IntegrityFindings check={integrity.supplier} testId="party-integrity-findings-supplier" />
          {offersRegisterTakeover(integrity.supplier) ? (
            <TakeFromRegisterButton
              disabled={swapLocked}
              testId="take-register-supplier"
              onClick={() => onTakeFromRegister("supplier")}
            />
          ) : null}
        </fieldset>

        <div className="-my-1 flex justify-center">
          <button
            type="button"
            onClick={requestSwap}
            // Keeps focus in the field she was editing, so the edit is not
            // saved on blur and the swap carries it instead.
            onMouseDown={(event) => event.preventDefault()}
            disabled={swapLocked}
            title={swapTitle}
            aria-keyshortcuts="X"
            data-testid="swap-parties"
            className="press inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-[12.5px] font-semibold text-accent hover:bg-fill-2 disabled:opacity-40"
          >
            <span aria-hidden>⇅</span> Vymeniť strany
          </button>
        </div>

        <fieldset>
          <legend className="sr-only">Odberateľ</legend>
          <div className={GROUP_HEADING}>
            <span className="eyebrow">Odberateľ</span>
            <IntegrityBadge check={integrity.customer} testId="party-integrity-customer" />
          </div>
          <div className={GROUP}>
            <Field
              label="Názov"
              value={draft.customerName}
              provenance={provenance.customerName}
              state={resolveState("customerName", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ customerName: value })}
              onCommit={commit}
              testId="field-customer-name"
              wide
            />
            <Field
              label="IČO"
              value={draft.customerIco}
              provenance={provenance.customerIco}
              state={resolveState("customerIco", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ customerIco: value })}
              onCommit={commit}
              testId="field-customer-ico"
            />
            <Field
              label="DIČ"
              value={draft.customerDic}
              provenance={provenance.customerDic}
              state={resolveState("customerDic")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ customerDic: value })}
              onCommit={commit}
              testId="field-customer-dic"
            />
            <Field
              label="IČ DPH"
              value={draft.customerIcDph}
              provenance={provenance.customerIcDph}
              state={resolveState("customerIcDph", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ customerIcDph: value })}
              onCommit={commit}
              testId="field-customer-ic-dph"
              wide
            />
          </div>
          <IntegrityFindings check={integrity.customer} testId="party-integrity-findings-customer" />
          {offersRegisterTakeover(integrity.customer) ? (
            <TakeFromRegisterButton
              disabled={swapLocked}
              testId="take-register-customer"
              onClick={() => onTakeFromRegister("customer")}
            />
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="sr-only">Doklad</legend>
          <p className={`${GROUP_HEADING} eyebrow`}>Doklad</p>
          <div className={GROUP}>
            <Field
              label="Číslo dokladu"
              value={draft.documentNumber}
              state={resolveState("documentNumber")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ documentNumber: value, receiptNumber: value })}
              onCommit={commit}
              testId="field-document-number"
            />
            <Field
              label="Variabilný symbol"
              value={draft.variableSymbol}
              state={resolveState("variableSymbol")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ variableSymbol: value })}
              onCommit={commit}
              testId="field-variable-symbol"
            />
            <Field
              label="Dátum vystavenia"
              value={draft.issueDateRaw}
              state={resolveState("issueDateRaw")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ issueDateRaw: value })}
              onCommit={commit}
              testId="field-issue-date"
              placeholder="16.04.2026"
            />
            <Field
              label="DUZP"
              value={draft.taxableSupplyDateRaw}
              state={resolveState("taxableSupplyDateRaw")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ taxableSupplyDateRaw: value })}
              onCommit={commit}
              testId="field-taxable-supply-date"
              placeholder="16.04.2026"
            />
            <Field
              label="Dátum splatnosti"
              value={draft.dueDateRaw}
              state={resolveState("dueDateRaw")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ dueDateRaw: value })}
              onCommit={commit}
              testId="field-due-date"
              placeholder="30.04.2026"
              wide
            />
            <Field
              label="Mena"
              value={draft.currency}
              state={resolveState("currency")}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ currency: value })}
              onCommit={commit}
              testId="field-currency"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="sr-only">Sumy</legend>
          <p className={`${GROUP_HEADING} eyebrow`}>Sumy</p>
          <div className={GROUP}>
            <Field
              label="Celkom"
              value={draft.amountLiteral}
              provenance={provenance.amountLiteral}
              state={resolveState("amountLiteral", arithmeticFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ amountLiteral: value }, ["amountLiteral"])}
              onCommit={commit}
              testId="field-amount"
              money
            />
            <Field
              label="Základ DPH (SPOLU)"
              value={draft.recapBaseLiteral}
              provenance={provenance.recapBaseLiteral}
              state={resolveState("recapBaseLiteral", arithmeticFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ recapBaseLiteral: value }, ["recapBaseLiteral"])}
              onCommit={commit}
              testId="field-recap-base"
              money
            />
            <Field
              label="DPH (SPOLU)"
              value={draft.recapVatLiteral}
              provenance={provenance.recapVatLiteral}
              state={resolveState("recapVatLiteral", arithmeticFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ recapVatLiteral: value }, ["recapVatLiteral"])}
              onCommit={commit}
              testId="field-recap-vat"
              money
            />
            {advance ? (
              <>
                <Field
                  label="Odpočet zálohy"
                  value={formatSkMoney(advance.advanceDeductedCents)}
                  provenance={advance.source === "manual" ? "confirmed" : "extracted"}
                  state="correct"
                  readOnly
                  disabled={false}
                  onChange={() => undefined}
                  onCommit={() => undefined}
                  testId="advance-deducted"
                  money
                />
                <Field
                  label="K úhrade"
                  value={formatSkMoney(advance.amountDueCents)}
                  provenance="derived"
                  state="correct"
                  readOnly
                  disabled={false}
                  onChange={() => undefined}
                  onCommit={() => undefined}
                  testId="amount-due"
                  money
                />
              </>
            ) : null}
          </div>

          {advanceAvailable ? (
            <label
              className="mt-2 flex items-center gap-2.5 rounded-xl bg-surface px-3.5 py-2.5 text-[14px] shadow-[0_0_0_1px_rgb(0_0_0/0.04)]"
              title={advanceLocked ? advanceTitle : undefined}
            >
              <input
                type="checkbox"
                checked={advance !== null}
                disabled={advanceLocked}
                onChange={(event) => onSetAdvanceSettlement(event.target.checked)}
                data-testid="advance-settlement-toggle"
                className="size-4 accent-[#2b5d72]"
              />
              Vyúčtovanie zálohy
              {document.fieldEditor.advanceSettlementOverride !== null &&
              document.fieldEditor.advanceSettlementOverride !== undefined ? (
                <span className="text-ink-3">(určené ručne)</span>
              ) : null}
            </label>
          ) : null}

          {advance ? (
            <>
              <p
                className="mt-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent"
                data-testid="advance-settlement-hint"
              >
                Vyúčtovanie zálohy — k úhrade {formatSkMoney(advance.amountDueCents)}, účtuje sa plná suma
              </p>
              {advance.advanceDocumentNumbers.length > 0 ? (
                <p className="mt-2 px-1 text-[12.5px] text-ink-3" data-testid="advance-documents">
                  Zálohové doklady: {advance.advanceDocumentNumbers.join(", ")}
                </p>
              ) : null}
              {advance.identityWarning ? (
                <p
                  className="mt-2 flex items-start gap-1.5 rounded-xl bg-warn-soft px-3.5 py-2 text-[13px] text-warn-strong"
                  data-testid="advance-identity-warning"
                >
                  <span aria-hidden>!</span>
                  <span>{advance.identityWarning}</span>
                </p>
              ) : null}
              {(advance.findings ?? []).map((finding, index) => (
                <p
                  key={index}
                  className="mt-2 flex items-start gap-1.5 rounded-xl bg-warn-soft px-3.5 py-2 text-[13px] text-warn-strong"
                  data-testid="advance-finding"
                >
                  <span aria-hidden>!</span>
                  <span>{finding}</span>
                </p>
              ))}
            </>
          ) : null}

          {cashRounding !== null && (
            <p
              className="mt-2 px-1 text-[12.5px] text-ink-3"
              data-testid="cash-rounding"
            >
              Zaokrúhlenie platby v hotovosti:{" "}
              {formatCashRounding(cashRounding, draftFieldsForChecks.currency)}
            </p>
          )}

          {arithmeticWarnings.map((warning, index) => (
            <p
              key={index}
              className="mt-2 flex items-start gap-1.5 rounded-xl bg-warn-soft px-3.5 py-2 text-[13px] text-warn-strong"
              data-testid={index === 0 ? "arithmetic-warning" : undefined}
            >
              <span aria-hidden>!</span>
              <span>{warning}</span>
            </p>
          ))}
        </fieldset>

        <fieldset>
          <legend className="sr-only">DPH podľa sadzby</legend>
          <div className={GROUP_HEADING}>
            <span className="eyebrow">DPH podľa sadzby</span>
            {vatCheck ? (
              <span className={`text-[12px] ${vatCheck.ok ? "text-good" : "text-warn"}`} data-testid="vat-check">
                {vatCheck.text}
              </span>
            ) : null}
          </div>
          <div className={GROUP}>
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="text-[12px] text-ink-3">
                  <th className="py-2 pl-3.5 text-left font-medium">Sadzba</th>
                  <th className="py-2 text-right font-medium">Základ</th>
                  <th className="py-2 text-right font-medium">DPH</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {draft.vatRecap.map((row, index) => (
                  <tr key={index} data-testid={`vat-recap-row-${index}`} className="border-t border-line">
                    <td className="py-1 pl-3.5">
                      <CellInput
                        value={row.rateLiteral}
                        provenance={provenance.vatRecap}
                        readOnly={readOnly}
                        disabled={pending}
                        placeholder="%"
                        testId={`field-vat-rate-${index}`}
                        state={resolveState("vatRecap", arithmeticFlagged)}
                        onChange={(value) => updateVatRow(index, { rateLiteral: value })}
                        onCommit={commit}
                        align="left"
                      />
                    </td>
                    <td className="py-1 pl-2">
                      <CellInput
                        value={row.baseLiteral}
                        provenance={provenance.vatRecap}
                        readOnly={readOnly}
                        disabled={pending}
                        placeholder="Základ"
                        testId={`field-vat-base-${index}`}
                        state={resolveState("vatRecap", arithmeticFlagged)}
                        onChange={(value) => updateVatRow(index, { baseLiteral: value })}
                        onCommit={commit}
                      />
                    </td>
                    <td className="py-1 pl-2">
                      <CellInput
                        value={row.vatLiteral}
                        provenance={provenance.vatRecap}
                        readOnly={readOnly}
                        disabled={pending}
                        placeholder="DPH"
                        testId={`field-vat-amount-${index}`}
                        state={resolveState("vatRecap", arithmeticFlagged)}
                        onChange={(value) => updateVatRow(index, { vatLiteral: value })}
                        onCommit={commit}
                      />
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {!readOnly && draft.vatRecap.length > 1 ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            commitVatRows(draft.vatRecap.filter((_, rowIndex) => rowIndex !== index))
                          }
                          className="press grid size-7 place-items-center rounded-full"
                          aria-label={`Odstrániť sadzbu ${index + 1}`}
                        >
                          <span aria-hidden className="grid size-4 place-items-center rounded-full bg-ink-4 text-[13px] leading-none font-bold text-white">
                            −
                          </span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!readOnly ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  patch({
                    vatRecap: [...draft.vatRecap, { rateLiteral: "", baseLiteral: "", vatLiteral: "" }],
                  })
                }
                data-testid="add-vat-recap-row"
                className="press flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-[14px] font-medium text-accent hover:bg-surface-2"
              >
                <span aria-hidden className="grid size-4 place-items-center rounded-full bg-accent text-[13px] leading-none font-bold text-white">
                  +
                </span>
                Pridať sadzbu DPH
              </button>
            ) : null}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`document-note-${document.id}`} className={GROUP_HEADING}>
            <span className="eyebrow">Poznámka</span>
            <span className="text-[12px] text-ink-3">vidí ju celá kancelária</span>
          </label>
          {readOnly ? (
            <p className="rounded-xl bg-surface px-3.5 py-3 text-[14px] text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.04)]">
              {note || "—"}
            </p>
          ) : (
            <textarea
              id={`document-note-${document.id}`}
              value={note}
              rows={3}
              onChange={(event) => onNoteChange(event.target.value)}
              onBlur={onNoteSave}
              placeholder="Napr. dobropis príde v decembri, klient doplní IČO…"
              aria-label="Poznámka k dokladu"
              data-testid={`document-note-${document.id}`}
              className="block w-full resize-y rounded-xl bg-surface px-3.5 py-3 text-[14px] shadow-[0_0_0_1px_rgb(0_0_0/0.04)] outline-none placeholder:text-ink-4 focus:shadow-[0_0_0_2px_rgb(43_93_114/0.45)]"
            />
          )}
          {!readOnly && noteDirty ? (
            <p className="mt-1 px-1 text-[12px] text-ink-3">Uloží sa pri opustení poľa.</p>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="flex items-center gap-2.5 px-1">
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={commit}
              data-testid="save-document-fields"
              className="press rounded-lg bg-fill px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
            >
              Uložiť údaje
            </button>
            <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
              {dirty ? (
                <>
                  <i aria-hidden className="inline-block size-1.5 rounded-full bg-warn-dot" />
                  Neuložené zmeny
                </>
              ) : saveState === "saving" ? (
                "Ukladám…"
              ) : (
                <>
                  <i aria-hidden className="inline-block size-1.5 rounded-full bg-good-dot" />
                  Všetko uložené
                </>
              )}
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

const VERDICT_TONE: Record<IntegrityVerdict, string> = {
  verified: "text-good",
  valid: "text-ink-3",
  notice: "text-warn",
  mismatch: "text-bad",
  unverifiable: "text-ink-3",
  unavailable: "text-warn",
};

/** The verdict of one party, shown beside its fieldset's legend. */
function IntegrityBadge({ check, testId }: { check: SubjectCheck; testId: string }) {
  return (
    <span
      className={`text-[12px] font-medium ${VERDICT_TONE[check.verdict]}`}
      data-testid={testId}
      data-verdict={check.verdict}
    >
      {verdictLabel(check.verdict)}
    </span>
  );
}

/** Takes the register's name, DIČ and IČ DPH for a flagged party (PRD 0004, story 34). */
function TakeFromRegisterButton({
  disabled,
  testId,
  onClick,
}: {
  disabled: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-2 px-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title="Názov, DIČ a IČ DPH z registra sa zapíšu ako tvoje údaje. IČO sa nemení."
        data-testid={testId}
        className="press rounded-lg bg-surface px-3 py-1.5 text-[13px] font-semibold text-accent shadow-[0_0_0_1px_rgb(0_0_0/0.08)] disabled:opacity-40"
      >
        Prevziať z registra
      </button>
    </div>
  );
}

/** What is wrong with a party, in Slovak; nothing when all is well. */
function IntegrityFindings({ check, testId }: { check: SubjectCheck; testId: string }) {
  if (check.findings.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 space-y-0.5 px-1 text-[12.5px]" data-testid={testId}>
      {check.findings.map((item, index) => (
        <li key={index} className={item.severity === "mismatch" ? "text-bad" : "text-warn"}>
          {subjectFindingMessage(item)}
        </li>
      ))}
    </ul>
  );
}

function ProvenanceTag({ provenance }: { provenance: FieldProvenance }) {
  if (provenance === "extracted") {
    return (
      <span
        className="rounded-[2px] bg-accent-soft rounded-[4px] px-1 py-px text-[10px] font-bold tracking-[0.02em] uppercase text-accent"
        title="Hodnota z dokladu"
      >
        auto
      </span>
    );
  }
  if (provenance === "confirmed") {
    return (
      <span
        className="rounded-[2px] bg-surface-3 rounded-[4px] px-1 py-px text-[10px] font-bold tracking-[0.02em] uppercase text-ink-2"
        title="Hodnota, ktorú si zadala"
      >
        moje
      </span>
    );
  }
  if (provenance === "derived") {
    return (
      <span
        className="rounded-[2px] bg-accent-soft rounded-[4px] px-1 py-px text-[10px] font-bold tracking-[0.02em] uppercase text-accent"
        title="Hodnota vypočítaná z iných údajov"
      >
        vypočítané
      </span>
    );
  }
  if (provenance === "profile") {
    return (
      <span
        className="rounded-[2px] bg-surface-3 rounded-[4px] px-1 py-px text-[10px] font-bold tracking-[0.02em] uppercase text-ink-2"
        title="Hodnota z profilu firmy"
      >
        profil
      </span>
    );
  }
  if (provenance === "register") {
    return (
      <span
        className="rounded-[2px] bg-good-soft rounded-[4px] px-1 py-px text-[10px] font-bold tracking-[0.02em] uppercase text-good"
        title="Hodnota prevzatá z registra"
      >
        z registra
      </span>
    );
  }
  if (provenance === "directory") {
    return (
      <span
        className="rounded-[2px] bg-surface-3 rounded-[4px] px-1 py-px text-[10px] font-bold tracking-[0.02em] uppercase text-ink-2"
        title="Doplnená z adresára subjektov"
      >
        z adresára
      </span>
    );
  }
  return null;
}

function Field({
  label,
  value,
  provenance = "empty",
  state,
  readOnly,
  disabled,
  onChange,
  onCommit,
  testId,
  placeholder,
  money,
  wide,
}: {
  label: string;
  value: string;
  provenance?: FieldProvenance;
  state: FieldCheckState;
  readOnly: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  testId: string;
  placeholder?: string;
  money?: boolean;
  wide?: boolean;
}) {
  void wide;
  return (
    <label
      className={`flex min-w-0 items-center gap-3 border-t border-line px-3.5 py-2 transition-colors first:border-t-0 focus-within:bg-[#f5f8fa] ${fieldStateClass(state)}`}
    >
      <span className="flex w-[124px] shrink-0 flex-wrap items-center gap-x-1.5 text-[14px] text-ink-2">
        {label}
        <ProvenanceTag provenance={provenance} />
      </span>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder ?? (state === "empty" ? "Doplniť" : undefined)}
        inputMode={money ? "decimal" : undefined}
        onChange={(event) => {
          const next = event.target.value;
          if (!money || DECIMAL_INPUT_PATTERN.test(next)) {
            onChange(next);
          }
        }}
        onBlur={onCommit}
        data-testid={testId}
        data-field-state={state}
        className={`min-h-[28px] w-full min-w-0 bg-transparent text-right text-[14px] outline-none placeholder:text-ink-4 focus:text-accent read-only:text-ink-2 disabled:text-ink-2 ${
          state === "flagged" ? "text-warn-strong" : "text-ink"
        } ${money ? "tabular" : ""}`}
      />
    </label>
  );
}

function CellInput({
  value,
  provenance = "empty",
  readOnly,
  disabled,
  placeholder,
  testId,
  state,
  onChange,
  onCommit,
  align = "right",
}: {
  value: string;
  provenance?: FieldProvenance;
  readOnly: boolean;
  disabled: boolean;
  placeholder: string;
  testId: string;
  state: FieldCheckState;
  onChange: (value: string) => void;
  onCommit: () => void;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${align === "left" ? "items-start" : "items-end"}`}>
      <ProvenanceTag provenance={provenance} />
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(event) => {
          const next = event.target.value;
          if (DECIMAL_INPUT_PATTERN.test(next)) {
            onChange(next);
          }
        }}
        onBlur={onCommit}
        data-testid={testId}
        data-field-state={state}
        aria-label={placeholder}
        className={`tabular w-full min-w-0 rounded-md bg-transparent px-1 py-1 text-[14px] outline-none placeholder:text-ink-4 focus:text-accent ${
          align === "left" ? "text-left" : "text-right"
        } ${fieldStateClass(state)}`}
      />
    </div>
  );
}
