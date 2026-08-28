"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReconciliationView } from "@/lib/reconciliation/view";
import { driveFileViewUrl, previewKindForMimeType } from "@/modules/file-preview";
import {
  confirmPaymentFormAction,
  pairPaymentFormAction,
  savePaymentNoteAction,
  saveProofNoteAction,
  unpairPaymentAction,
} from "../../../actions";

type ReconciliationPanelProps = {
  companyId: number;
  monthKey: string;
  view: ReconciliationView;
  folderFilters: string[];
};

export function ReconciliationPanel({
  companyId,
  monthKey,
  view,
  folderFilters,
}: ReconciliationPanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(
    view.payments[0]?.id ?? null,
  );
  const [selectedProofId, setSelectedProofId] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  const filteredProofs = useMemo(() => {
    const proofs = [...view.unpairedProofs, ...view.pairedProofs];
    if (!folderFilter) {
      return proofs;
    }
    return proofs.filter((proof) => proof.folderSlot === folderFilter);
  }, [folderFilter, view.pairedProofs, view.unpairedProofs]);

  const selectedPayment = view.payments.find((payment) => payment.id === selectedPaymentId) ?? null;
  const proofNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const proof of [...view.unpairedProofs, ...view.pairedProofs]) {
      map.set(proof.driveFileId, proof.name);
    }
    return map;
  }, [view.pairedProofs, view.unpairedProofs]);
  const selectedProof =
    filteredProofs.find((proof) => proof.driveFileId === selectedProofId) ??
    filteredProofs.find((proof) => proof.driveFileId === selectedPayment?.pairedProofIds[0]) ??
    null;

  const previewFileId = selectedProof?.driveFileId ?? selectedPayment?.blocekFileId ?? null;
  const previewMimeType = selectedProof?.mimeType ?? "application/pdf";

  function runAction(action: () => Promise<{ ok: boolean; message?: string }>) {
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
    <div className="flex flex-col gap-4" data-testid="reconciliation-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="remaining-count">
          {view.untickedCount} unticked payment{view.untickedCount === 1 ? "" : "s"}
        </p>
        {folderFilters.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Folder</span>
            <select
              className="rounded border border-border bg-background px-2 py-1"
              value={folderFilter ?? ""}
              onChange={(event) =>
                setFolderFilter(event.target.value.length > 0 ? event.target.value : null)
              }
              data-testid="folder-filter"
            >
              <option value="">All proof folders</option>
              {folderFilters.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {(view.unpairedPaymentWarnings.length > 0 || view.unpairedProofWarnings.length > 0) ? (
        <section
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          data-testid="reconciliation-warnings"
        >
          <h2 className="mb-2 font-medium">Warnings</h2>
          {view.unpairedPaymentWarnings.length > 0 ? (
            <ul className="mb-2 space-y-1">
              {view.unpairedPaymentWarnings.map((warning) => (
                <li key={warning.paymentId} data-testid="unpaired-payment-warning">
                  Payment without proof: {warning.label}
                </li>
              ))}
            </ul>
          ) : null}
          {view.unpairedProofWarnings.length > 0 ? (
            <ul className="space-y-1">
              {view.unpairedProofWarnings.map((warning) => (
                <li key={warning.driveFileId} data-testid="unpaired-proof-warning">
                  Proof without payment: {warning.name}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
        <section className="rounded-lg border border-border p-3" data-testid="payments-column">
          <h2 className="mb-2 text-sm font-medium">Payments</h2>
          <ul className="space-y-2">
            {view.payments.map((payment) => (
              <li
                key={payment.id}
                className={`rounded-md border p-2 text-sm ${
                  selectedPaymentId === payment.id ? "border-primary" : "border-border/60"
                }`}
                data-testid="reconciliation-payment"
              >
                <form action={confirmPaymentFormAction} className="flex items-start gap-2">
                  <input type="hidden" name="companyId" value={companyId} />
                  <input type="hidden" name="monthKey" value={monthKey} />
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input
                    type="hidden"
                    name="confirmed"
                    value={payment.confirmed ? "false" : "true"}
                    id={`payment-confirmed-${payment.id}`}
                  />
                  <input
                    type="checkbox"
                    checked={payment.confirmed}
                    disabled={view.readOnly || pending}
                    onChange={(event) => {
                      const hidden = document.getElementById(
                        `payment-confirmed-${payment.id}`,
                      ) as HTMLInputElement | null;
                      if (hidden) {
                        hidden.value = event.currentTarget.checked ? "true" : "false";
                      }
                      event.currentTarget.form?.requestSubmit();
                    }}
                    data-testid={`payment-tick-${payment.id}`}
                    aria-label={`Confirm payment ${payment.label}`}
                  />
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      setSelectedPaymentId(payment.id);
                      setSelectedProofId(null);
                    }}
                  >
                    <p className="font-medium">{payment.label}</p>
                    <p className="text-muted-foreground">{payment.amountDisplay}</p>
                    <p className="text-xs text-muted-foreground">{payment.derivedStatus.hint}</p>
                  </button>
                </form>
                {payment.pairedProofIds.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-border/40 pt-2 text-xs">
                    {payment.pairedProofIds.map((proofId) => (
                      <li key={proofId} className="flex items-center justify-between gap-2">
                        <span className="truncate">{proofNameById.get(proofId) ?? proofId}</span>
                        {!view.readOnly ? (
                          <button
                            type="button"
                            className="shrink-0 underline"
                            disabled={pending}
                            onClick={() =>
                              runAction(() =>
                                unpairPaymentAction({
                                  companyId,
                                  monthKey,
                                  pairingId: payment.pairingIdsByProofId[proofId]!,
                                }),
                              )
                            }
                            data-testid={`unpair-${payment.id}-${proofId}`}
                          >
                            Unpair
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!view.readOnly ? (
                  <PaymentNoteEditor
                    paymentId={payment.id}
                    initialNote={payment.note ?? ""}
                    disabled={pending}
                    onSave={(note) =>
                      runAction(() =>
                        savePaymentNoteAction({
                          companyId,
                          monthKey,
                          paymentId: payment.id,
                          note,
                        }),
                      )
                    }
                  />
                ) : payment.note ? (
                  <p className="mt-2 text-xs text-muted-foreground">Note: {payment.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border p-3" data-testid="proofs-column">
          <h2 className="mb-2 text-sm font-medium">Proofs</h2>
          <ul className="space-y-2">
            {filteredProofs.map((proof) => (
              <li
                key={proof.driveFileId}
                className={`rounded-md border p-2 text-sm ${
                  selectedProof?.driveFileId === proof.driveFileId
                    ? "border-primary"
                    : "border-border/60"
                }`}
                data-testid="reconciliation-proof"
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setSelectedProofId(proof.driveFileId)}
                >
                  <p className="font-medium">{proof.name}</p>
                  <p className="text-xs text-muted-foreground">{proof.folderSlot}</p>
                </button>
                {!view.readOnly && selectedPayment && selectedPayment.needsPairing ? (
                  <form action={pairPaymentFormAction} className="mt-2">
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="monthKey" value={monthKey} />
                    <input type="hidden" name="paymentId" value={selectedPayment.id} />
                    <input type="hidden" name="proofDriveFileId" value={proof.driveFileId} />
                    <button
                      type="submit"
                      className="text-xs underline"
                      disabled={
                        pending ||
                        proof.pairedPaymentIds.includes(selectedPayment.id)
                      }
                      data-testid={`pair-${selectedPayment.id}-${proof.driveFileId}`}
                    >
                      Pair with selected payment
                    </button>
                  </form>
                ) : null}
                {!view.readOnly ? (
                  <ProofNoteEditor
                    proofDriveFileId={proof.driveFileId}
                    initialNote={proof.note ?? ""}
                    disabled={pending}
                    onSave={(note) =>
                      runAction(() =>
                        saveProofNoteAction({
                          companyId,
                          monthKey,
                          proofDriveFileId: proof.driveFileId,
                          note,
                        }),
                      )
                    }
                  />
                ) : proof.note ? (
                  <p className="mt-2 text-xs text-muted-foreground">Note: {proof.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border p-3" data-testid="preview-pane">
          <h2 className="mb-2 text-sm font-medium">Preview</h2>
          {previewFileId ? (
            <PreviewPane driveFileId={previewFileId} mimeType={previewMimeType} name={selectedProof?.name ?? selectedPayment?.label ?? "Document"} />
          ) : (
            <p className="text-sm text-muted-foreground">Select a payment or proof.</p>
          )}
        </section>
      </div>

      {error ? (
        <p className="text-sm text-red-700" data-testid="reconciliation-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PaymentNoteEditor({
  paymentId,
  initialNote,
  disabled,
  onSave,
}: {
  paymentId: number;
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
        data-testid={`payment-note-${paymentId}`}
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

function ProofNoteEditor({
  proofDriveFileId,
  initialNote,
  disabled,
  onSave,
}: {
  proofDriveFileId: string;
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
        data-testid={`proof-note-${proofDriveFileId}`}
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

  if (kind === "heic-fallback") {
    return (
      <div className="text-sm" data-testid="heic-fallback">
        <p className="mb-2 text-muted-foreground">
          HEIC preview is not available in the browser. Open the original in Drive.
        </p>
        <a
          className="underline"
          href={driveFileViewUrl(driveFileId)}
          target="_blank"
          rel="noreferrer"
        >
          Open {name} in Drive
        </a>
      </div>
    );
  }

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
      <a className="underline" href={driveFileViewUrl(driveFileId)} target="_blank" rel="noreferrer">
        Open in Drive
      </a>
    </p>
  );
}
