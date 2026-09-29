"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentListItem } from "@/lib/documents/view";
import {
  cashRoundingOfFields,
  checkArithmeticWarnings,
  fieldCheckState,
  type FieldCheckState,
} from "@/modules/document-fields";
import { validateEkasaUidInput } from "@/modules/ekasa-identifiers";
import { rebaseDraft } from "@/modules/draft-rebase";

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
  note: string;
  onNoteChange: (note: string) => void;
  onNoteSave: () => void;
  noteDirty: boolean;
  onLookupUid: (uid: string) => void;
  uidLookupMessage: string | null;
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
  const match = /^(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const centsFromFraction =
    fraction.length === 0 ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
  return Number(whole) * 100 + centsFromFraction;
}

function fieldStateClass(state: FieldCheckState): string {
  if (state === "empty") {
    return "border-dashed border-ink-3/40 bg-surface";
  }
  if (state === "flagged") {
    return "border-warn bg-warn-soft";
  }
  return "border-line bg-surface-2";
}

export function FieldsPanel({
  document,
  readOnly,
  pending,
  saveState,
  onSave,
  note,
  onNoteChange,
  onNoteSave,
  noteDirty,
  onLookupUid,
  uidLookupMessage,
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

  const documentId = document?.id ?? null;
  const loadedDocumentId = useRef<string | null>(documentId);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    const next = document ? draftFrom(document) : null;
    if (loadedDocumentId.current !== documentId) {
      // Another document: start from what it holds.
      loadedDocumentId.current = documentId;
      setDraft(next);
      setSaved(next);
      setUidDraft(document?.typedEkasaUid ?? "");
      setUidValidationMessage(null);
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

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  if (!document || !draft) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-ink-3">Žiadny doklad.</p>
      </div>
    );
  }

  const {
    provenance,
    fieldChecks,
    docTypeHint,
    nonEurCurrency,
    homeCurrency,
    rolesFlagged,
    missingProfile,
    exportSectionResolved,
  } = document.fieldEditor;

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

  const arithmeticWarnings = checkArithmeticWarnings(draftFieldsForChecks);
  const cashRounding = cashRoundingOfFields(draftFieldsForChecks);
  const amountCheckOk = fieldChecks?.amountLiteral === "correct";
  const vatCheckOk = fieldChecks?.vatRecap === "correct";
  const arithmeticFlagged =
    !isCreditNote &&
    arithmeticWarnings.length > 0 &&
    !(amountCheckOk && (draftFieldsForChecks.vatRecap.length === 0 || vatCheckOk));

  function patch(next: Partial<DocumentFieldsInput>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function commit() {
    if (readOnly || !dirty || !draft) {
      return;
    }
    setSaved(draft);
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
    const next = { ...draft!, vatRecap: rows };
    setDraft(next);
    if (!readOnly) {
      setSaved(next);
      onSave(next);
    }
  }

  return (
    <>
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3">
        <h2 className="eyebrow">Údaje dokladu</h2>
        {document.extractionSource ? (
          <span
            className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-2"
            data-testid="extraction-source-badge"
          >
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
        ) : null}
        <div className="flex-1" />
        <span className="text-[10.5px] text-ink-3">
          {readOnly ? "len na čítanie" : "ukladá sa pri opustení poľa"}
        </span>
      </div>
      {document.receiptOfFile ? (
        <p
          className="shrink-0 border-b border-line bg-surface px-3 py-1.5 text-[11.5px] text-ink-2"
          data-testid="receipt-of-file"
        >
          Bloček {document.receiptOfFile.index} z {document.receiptOfFile.count} v tomto súbore
        </p>
      ) : null}
      {document.sameReceiptAs.length > 0 ? (
        <p
          className="shrink-0 border-b border-line bg-warn-soft px-3 py-1.5 text-[11.5px] text-warn"
          data-testid="same-receipt-as"
        >
          Rovnaký bloček je aj v{" "}
          {document.sameReceiptAs
            .map((other) => `${other.fileName} (${other.monthKey.replace("_", "/")})`)
            .join(", ")}
          . Do Omegy pôjde len raz — druhý označ ako nerelevantný.
        </p>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <label className="text-[11px] text-ink-2" htmlFor="export-section">
          Sekcia v Omega
        </label>
        <select
          id="export-section"
          className="rounded border border-line bg-surface-2 px-2 py-1 text-[12px]"
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
          <option value="">
            Automaticky ({exportSectionResolved === "T01" ? "T01" : "T00"})
          </option>
          <option value="T01">Fakturácia (T01)</option>
          <option value="T00">EUD bločky (T00)</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3.5" data-testid="document-field-editor">
        {document.outsideEkasa ? (
          <p
            className="border-b border-line px-3 py-2 text-[11.5px] text-ink-2"
            data-testid="outside-ekasa"
          >
            Doklad nie je z eKasa (parkovací automat, lístok, faktúra): nemá
            UID, údaje sú prečítané z dokladu.
          </p>
        ) : null}
        {document.showUidBox ? (
          <fieldset className="border-b border-line px-3 py-3" data-testid="ekasa-uid-box">
            <legend className="eyebrow mb-2">UID eBločku</legend>
            <p className="mb-2 text-[11.5px] text-ink-3">
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
                className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 font-mono text-[12px] uppercase"
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
                className="shrink-0 rounded-md border border-line-2 bg-surface px-3 py-1.5 text-[12px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
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
            className="m-3 mb-0 border-l-2 border-accent bg-surface-2 px-2.5 py-2 text-[12px] text-ink-2"
            data-testid="proforma-hint"
          >
            Vyzerá to ako zálohová faktúra — stále rozhodni, či ju zaúčtuješ.
          </p>
        ) : null}

        {document.extractionFailureReason ? (
          <p
            className="m-3 mb-0 border-l-2 border-warn bg-warn-soft px-2.5 py-2 text-[12px] text-warn"
            data-testid="extraction-failure-reason"
          >
            {document.extractionFailureReason}
          </p>
        ) : null}

        {missingProfile ? (
          <p
            className="m-3 mb-0 border-l-2 border-warn bg-warn-soft px-2.5 py-2 text-[12px] text-warn"
            data-testid="missing-profile-warning"
          >
            Chýba profil firmy — strany dokladu sa nedajú priradiť.
          </p>
        ) : null}

        {rolesFlagged && !missingProfile ? (
          <p
            className="m-3 mb-0 border-l-2 border-warn bg-warn-soft px-2.5 py-2 text-[12px] text-warn"
            data-testid="party-roles-flagged"
          >
            Ani jedna strana nezodpovedá profilu klienta — skontroluj, či je doklad v správnom
            priečinku.
          </p>
        ) : null}

        {nonEurCurrency ? (
          <p
            className="m-3 mb-0 border-l-2 border-warn bg-warn-soft px-2.5 py-2 text-[12px] text-warn"
            data-testid="non-eur-warning"
          >
            Mena je {draft.currency}. Kurz sa neprepočítava — zadaj sumu v {homeCurrency}, ktorú
            chceš zaúčtovať.
          </p>
        ) : null}

        <fieldset className="border-b border-line px-3 py-3">
          <legend className="eyebrow mb-2">Dodávateľ</legend>
          <div className="grid grid-cols-2 gap-2">
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
              state={resolveState("icDph", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ icDph: value })}
              onCommit={commit}
              testId="field-ic-dph"
              wide
            />
          </div>
        </fieldset>

        <fieldset className="border-b border-line px-3 py-3">
          <legend className="eyebrow mb-2">Odberateľ</legend>
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Názov"
              value={draft.customerName}
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
              state={resolveState("customerIcDph", roleFieldFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ customerIcDph: value })}
              onCommit={commit}
              testId="field-customer-ic-dph"
              wide
            />
          </div>
        </fieldset>

        <fieldset className="border-b border-line px-3 py-3">
          <legend className="eyebrow mb-2">Doklad</legend>
          <div className="grid grid-cols-2 gap-2">
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

        <fieldset className="border-b border-line px-3 py-3">
          <legend className="eyebrow mb-2">Sumy</legend>
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Celkom"
              value={draft.amountLiteral}
              state={resolveState("amountLiteral", arithmeticFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ amountLiteral: value })}
              onCommit={commit}
              testId="field-amount"
              money
            />
            <Field
              label="Základ DPH (SPOLU)"
              value={draft.recapBaseLiteral}
              state={resolveState("recapBaseLiteral", arithmeticFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ recapBaseLiteral: value })}
              onCommit={commit}
              testId="field-recap-base"
              money
            />
            <Field
              label="DPH (SPOLU)"
              value={draft.recapVatLiteral}
              state={resolveState("recapVatLiteral", arithmeticFlagged)}
              readOnly={readOnly}
              disabled={pending}
              onChange={(value) => patch({ recapVatLiteral: value })}
              onCommit={commit}
              testId="field-recap-vat"
              money
            />
          </div>

          {cashRounding !== null && (
            <p
              className="mt-2.5 text-[11.5px] text-ink-3"
              data-testid="cash-rounding"
            >
              Zaokrúhlenie platby v hotovosti:{" "}
              {formatCashRounding(cashRounding, draftFieldsForChecks.currency)}
            </p>
          )}

          {arithmeticWarnings.map((warning, index) => (
            <p
              key={index}
              className="mt-2.5 flex items-start gap-1.5 rounded-md bg-warn-soft px-2.5 py-1.5 text-[11.5px] text-warn"
              data-testid={index === 0 ? "arithmetic-warning" : undefined}
            >
              <span aria-hidden>!</span>
              <span>{warning}</span>
            </p>
          ))}
        </fieldset>

        <fieldset className="border-b border-line px-3 py-3">
          <legend className="eyebrow mb-2">DPH podľa sadzby</legend>
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                <th className="pb-1.5 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Sadzba
                </th>
                <th className="pb-1.5 text-right text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Základ
                </th>
                <th className="pb-1.5 text-right text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  DPH
                </th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {draft.vatRecap.map((row, index) => (
                <tr key={index} data-testid={`vat-recap-row-${index}`}>
                  <td className="border-t border-line py-1 pr-1">
                    <CellInput
                      value={row.rateLiteral}
                      readOnly={readOnly}
                      disabled={pending}
                      placeholder="%"
                      testId={`field-vat-rate-${index}`}
                      state={resolveState("vatRecap", arithmeticFlagged)}
                      onChange={(value) => updateVatRow(index, { rateLiteral: value })}
                      onCommit={commit}
                    />
                  </td>
                  <td className="border-t border-line py-1 pr-1">
                    <CellInput
                      value={row.baseLiteral}
                      readOnly={readOnly}
                      disabled={pending}
                      placeholder="Základ"
                      testId={`field-vat-base-${index}`}
                      state={resolveState("vatRecap", arithmeticFlagged)}
                      onChange={(value) => updateVatRow(index, { baseLiteral: value })}
                      onCommit={commit}
                    />
                  </td>
                  <td className="border-t border-line py-1 pr-1">
                    <CellInput
                      value={row.vatLiteral}
                      readOnly={readOnly}
                      disabled={pending}
                      placeholder="DPH"
                      testId={`field-vat-amount-${index}`}
                      state={resolveState("vatRecap", arithmeticFlagged)}
                      onChange={(value) => updateVatRow(index, { vatLiteral: value })}
                      onCommit={commit}
                    />
                  </td>
                  <td className="border-t border-line py-1 text-right">
                    {!readOnly && draft.vatRecap.length > 1 ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          commitVatRows(
                            draft.vatRecap.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
                        className="text-[11px] text-ink-3 hover:text-bad"
                        aria-label={`Odstrániť sadzbu ${index + 1}`}
                      >
                        ✕
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
                commitVatRows([
                  ...draft.vatRecap,
                  { rateLiteral: "", baseLiteral: "", vatLiteral: "" },
                ])
              }
              data-testid="add-vat-recap-row"
              className="mt-2 text-[11.5px] text-accent underline underline-offset-2"
            >
              Pridať sadzbu DPH
            </button>
          ) : null}
        </fieldset>

        <fieldset className="border-b border-line px-3 py-3">
          <legend className="eyebrow mb-2">Poznámka</legend>
          {readOnly ? (
            <p className="text-[12.5px] text-ink-2">{note || "—"}</p>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                onBlur={onNoteSave}
                placeholder="Poznámka k dokladu"
                aria-label="Poznámka k dokladu"
                data-testid={`document-note-${document.id}`}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12.5px]"
              />
              <button
                type="button"
                disabled={pending || !noteDirty}
                onClick={onNoteSave}
                className="text-[11.5px] text-accent underline underline-offset-2 disabled:text-ink-3 disabled:no-underline"
              >
                Uložiť
              </button>
            </div>
          )}
        </fieldset>

        {!readOnly ? (
          <div className="flex items-center gap-2.5 px-3 pt-3">
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={commit}
              data-testid="save-document-fields"
              className="rounded-md border border-line-2 bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
            >
              Uložiť údaje
            </button>
            <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
              {dirty ? (
                <>
                  <i aria-hidden className="inline-block size-1.5 rounded-full bg-warn" />
                  Neuložené zmeny
                </>
              ) : saveState === "saving" ? (
                "Ukladám…"
              ) : (
                <>
                  <i aria-hidden className="inline-block size-1.5 rounded-full bg-good" />
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

function ProvenanceTag({ provenance }: { provenance: "confirmed" | "extracted" | "empty" }) {
  if (provenance === "extracted") {
    return (
      <span
        className="rounded-[2px] bg-accent-soft px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-accent"
        title="Hodnota z dokladu"
      >
        auto
      </span>
    );
  }
  if (provenance === "confirmed") {
    return (
      <span
        className="rounded-[2px] bg-surface-3 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-2"
        title="Hodnota, ktorú si zadala"
      >
        moje
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
  provenance?: "confirmed" | "extracted" | "empty";
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
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
        {label}
        <ProvenanceTag provenance={provenance} />
      </span>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder ?? (state === "empty" ? "vyplň ručne" : undefined)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        data-testid={testId}
        data-field-state={state}
        className={`min-h-[30px] rounded-md border px-2 py-1.5 text-[12.5px] read-only:bg-surface read-only:text-ink-2 ${fieldStateClass(state)} ${
          money ? "text-right font-mono" : ""
        }`}
      />
    </label>
  );
}

function CellInput({
  value,
  readOnly,
  disabled,
  placeholder,
  testId,
  state,
  onChange,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  disabled: boolean;
  placeholder: string;
  testId: string;
  state: FieldCheckState;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      data-testid={testId}
      data-field-state={state}
      aria-label={placeholder}
      className={`w-full rounded-md border px-1.5 py-1 text-right font-mono text-[11.5px] read-only:bg-surface ${fieldStateClass(state)}`}
    />
  );
}
