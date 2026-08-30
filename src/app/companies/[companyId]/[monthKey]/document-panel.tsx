"use client";

import { useEffect, useState } from "react";
import type { DocumentActionResult } from "@/lib/documents/service";
import { useRouter } from "next/navigation";
import type { DocumentListItem, MonthDocumentView } from "@/lib/documents/view";
import { checkArithmeticWarning } from "@/modules/document-fields";
import { driveFileViewUrl, previewKindForMimeType } from "@/modules/file-preview";
import {
  confirmDocumentFormAction,
  dismissDocumentAction,
  saveDocumentFieldsAction,
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
              <DocumentFieldEditor
                key={selectedDocument.driveFileId}
                document={selectedDocument}
                readOnly={view.readOnly}
                disabled={pending}
                onSave={(fields) =>
                  runAction(() =>
                    saveDocumentFieldsAction({
                      companyId,
                      monthKey,
                      driveFileId: selectedDocument.driveFileId,
                      fields,
                    }),
                  )
                }
              />
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

type VatRecapRowInput = {
  rateLiteral: string;
  baseLiteral: string;
  vatLiteral: string;
};

function DocumentFieldEditor({
  document,
  readOnly,
  disabled,
  onSave,
}: {
  document: DocumentListItem;
  readOnly: boolean;
  disabled: boolean;
  onSave: (fields: {
    supplierName: string;
    ico: string;
    dic: string;
    icDph: string;
    receiptNumber: string;
    receiptTimestampRaw: string;
    currency: string;
    amountLiteral: string;
    recapBaseLiteral: string;
    recapVatLiteral: string;
    vatRecap: VatRecapRowInput[];
  }) => void;
}) {
  const { fields, provenance, nonEurCurrency } = document.fieldEditor;
  const [supplierName, setSupplierName] = useState(fields.supplierName);
  const [ico, setIco] = useState(fields.ico);
  const [dic, setDic] = useState(fields.dic);
  const [icDph, setIcDph] = useState(fields.icDph);
  const [receiptNumber, setReceiptNumber] = useState(fields.receiptNumber);
  const [receiptTimestampRaw, setReceiptTimestampRaw] = useState(
    fields.receiptTimestampRaw,
  );
  const [currency, setCurrency] = useState(fields.currency);
  const [amountLiteral, setAmountLiteral] = useState(fields.amountLiteral);
  const [recapBaseLiteral, setRecapBaseLiteral] = useState(fields.recapBaseLiteral);
  const [recapVatLiteral, setRecapVatLiteral] = useState(fields.recapVatLiteral);
  const [vatRecap, setVatRecap] = useState<VatRecapRowInput[]>(
    fields.vatRecap.length > 0
      ? fields.vatRecap.map((row) => ({
          rateLiteral: row.rateLiteral,
          baseLiteral: row.baseLiteral,
          vatLiteral: row.vatLiteral,
        }))
      : [{ rateLiteral: "", baseLiteral: "", vatLiteral: "" }],
  );

  useEffect(() => {
    setSupplierName(fields.supplierName);
    setIco(fields.ico);
    setDic(fields.dic);
    setIcDph(fields.icDph);
    setReceiptNumber(fields.receiptNumber);
    setReceiptTimestampRaw(fields.receiptTimestampRaw);
    setCurrency(fields.currency);
    setAmountLiteral(fields.amountLiteral);
    setRecapBaseLiteral(fields.recapBaseLiteral);
    setRecapVatLiteral(fields.recapVatLiteral);
    setVatRecap(
      fields.vatRecap.length > 0
        ? fields.vatRecap.map((row) => ({
            rateLiteral: row.rateLiteral,
            baseLiteral: row.baseLiteral,
            vatLiteral: row.vatLiteral,
          }))
        : [{ rateLiteral: "", baseLiteral: "", vatLiteral: "" }],
    );
  }, [document.driveFileId, fields]);

  const draftFields = {
    supplierName,
    ico,
    dic,
    icDph,
    receiptNumber,
    receiptTimestampRaw,
    receiptAt: fields.receiptAt,
    currency,
    amountLiteral,
    amountCents: amountLiteral ? fields.amountCents : null,
    recapBaseLiteral,
    recapBaseCents: recapBaseLiteral ? fields.recapBaseCents : null,
    recapVatLiteral,
    recapVatCents: recapVatLiteral ? fields.recapVatCents : null,
    vatRecap: fields.vatRecap,
  };

  const localWarning = checkArithmeticWarning({
    ...draftFields,
    amountCents: parseDraftCents(amountLiteral),
    recapBaseCents: parseDraftCents(recapBaseLiteral),
    recapVatCents: parseDraftCents(recapVatLiteral),
  });

  function handleSave() {
    onSave({
      supplierName,
      ico,
      dic,
      icDph,
      receiptNumber,
      receiptTimestampRaw,
      currency,
      amountLiteral,
      recapBaseLiteral,
      recapVatLiteral,
      vatRecap,
    });
  }

  return (
    <div className="mt-4 space-y-3" data-testid="document-field-editor">
      <h3 className="text-sm font-medium">Document fields</h3>

      {nonEurCurrency ? (
        <p className="text-sm text-amber-800" data-testid="non-eur-warning">
          Currency is {currency}. No exchange rate is applied — enter the EUR
          amount you want booked.
        </p>
      ) : null}

      {localWarning ? (
        <p className="text-sm text-amber-800" data-testid="arithmetic-warning">
          {localWarning}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <FieldInput
          label="Supplier"
          value={supplierName}
          provenance={provenance.supplierName}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setSupplierName}
          testId="field-supplier-name"
        />
        <FieldInput
          label="IČO"
          value={ico}
          provenance={provenance.ico}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setIco}
          testId="field-ico"
        />
        <FieldInput
          label="DIČ"
          value={dic}
          provenance={provenance.dic}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setDic}
          testId="field-dic"
        />
        <FieldInput
          label="IČ DPH"
          value={icDph}
          provenance={provenance.icDph}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setIcDph}
          testId="field-ic-dph"
        />
        <FieldInput
          label="Document number"
          value={receiptNumber}
          provenance={provenance.receiptNumber}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setReceiptNumber}
          testId="field-receipt-number"
        />
        <FieldInput
          label="Date, time optional"
          value={receiptTimestampRaw}
          provenance={provenance.receiptTimestampRaw}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setReceiptTimestampRaw}
          testId="field-receipt-timestamp"
          placeholder="16.04.2026 or 16.04.2026 14:05:59"
        />
        <FieldInput
          label="Currency"
          value={currency}
          provenance={provenance.currency}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setCurrency}
          testId="field-currency"
        />
        <FieldInput
          label="Total"
          value={amountLiteral}
          provenance={provenance.amountLiteral}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setAmountLiteral}
          testId="field-amount"
        />
        <FieldInput
          label="VAT base (SPOLU)"
          value={recapBaseLiteral}
          provenance={provenance.recapBaseLiteral}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setRecapBaseLiteral}
          testId="field-recap-base"
        />
        <FieldInput
          label="VAT amount (SPOLU)"
          value={recapVatLiteral}
          provenance={provenance.recapVatLiteral}
          readOnly={readOnly}
          disabled={disabled}
          onChange={setRecapVatLiteral}
          testId="field-recap-vat"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">VAT by rate</p>
        {vatRecap.map((row, index) => (
          <div
            key={index}
            className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
            data-testid={`vat-recap-row-${index}`}
          >
            <input
              className="rounded border border-border px-2 py-1 text-xs"
              value={row.rateLiteral}
              readOnly={readOnly}
              disabled={disabled}
              onChange={(event) =>
                updateVatRow(index, { rateLiteral: event.target.value })
              }
              placeholder="Rate %"
              data-testid={`field-vat-rate-${index}`}
            />
            <input
              className="rounded border border-border px-2 py-1 text-xs"
              value={row.baseLiteral}
              readOnly={readOnly}
              disabled={disabled}
              onChange={(event) =>
                updateVatRow(index, { baseLiteral: event.target.value })
              }
              placeholder="Base"
              data-testid={`field-vat-base-${index}`}
            />
            <input
              className="rounded border border-border px-2 py-1 text-xs"
              value={row.vatLiteral}
              readOnly={readOnly}
              disabled={disabled}
              onChange={(event) =>
                updateVatRow(index, { vatLiteral: event.target.value })
              }
              placeholder="VAT"
              data-testid={`field-vat-amount-${index}`}
            />
            {!readOnly && vatRecap.length > 1 ? (
              <button
                type="button"
                className="text-xs underline"
                disabled={disabled}
                onClick={() => removeVatRow(index)}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <button
            type="button"
            className="text-xs underline"
            disabled={disabled}
            onClick={addVatRow}
            data-testid="add-vat-recap-row"
          >
            Add VAT rate
          </button>
        ) : null}
        {provenance.vatRecap === "extracted" ? (
          <p className="text-xs text-muted-foreground">From extraction</p>
        ) : null}
      </div>

      {!readOnly ? (
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-sm"
          disabled={disabled}
          onClick={handleSave}
          data-testid="save-document-fields"
        >
          Save fields
        </button>
      ) : null}
    </div>
  );

  function updateVatRow(index: number, patch: Partial<VatRecapRowInput>) {
    setVatRecap((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function addVatRow() {
    setVatRecap((rows) => [
      ...rows,
      { rateLiteral: "", baseLiteral: "", vatLiteral: "" },
    ]);
  }

  function removeVatRow(index: number) {
    setVatRecap((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }
}

function FieldInput({
  label,
  value,
  provenance,
  readOnly,
  disabled,
  onChange,
  testId,
  placeholder,
}: {
  label: string;
  value: string;
  provenance: "confirmed" | "extracted" | "empty";
  readOnly: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  testId: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      {provenance === "extracted" ? (
        <span className="ml-1 text-muted-foreground">(from extraction)</span>
      ) : null}
      <input
        className="mt-0.5 w-full rounded border border-border px-2 py-1"
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        placeholder={placeholder}
      />
    </label>
  );
}

function parseDraftCents(literal: string): number | null {
  const trimmed = literal.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const centsFromFraction =
    fraction.length === 0 ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
  return Number(whole) * 100 + centsFromFraction;
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
