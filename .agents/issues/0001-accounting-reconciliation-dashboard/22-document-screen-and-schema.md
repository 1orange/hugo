# 22 — Document screen and schema, retiring the pairing model

Type: AFK
User stories: 26, 29, 30, 38, 39, 40, 41, 42, 44

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The pivot itself, in one slice: the `Document` becomes the primary entity, the month view and the
reconciliation view become one screen, and the pairing model is deleted rather than left dormant.

Nothing is deployed and there is no production data, so this is deletion rather than migration.
Keeping a schema shaped around a workflow that no longer exists would make every later feature pay
for the mismatch (ADR 0013).

### The model

One `documents` row per file in a processed folder — `01`, `02`, `04`, `05`, `06`. Files in `03`
are presence-only (slice 20) and `07 Mzdy` is out of scope.

Columns are the thin, stable, constantly-queried workflow fields: company, month, folder slot,
decision, not-relevant reason, decided timestamp, extraction state and failure reason, note,
`exportedAt`, export batch. Everything a parser produces is a JSON payload, and **her confirmed
values are a second payload** rather than an overwrite of the first, so improving a parser cannot
destroy what she typed. A field is promoted from payload to column when something needs to query,
sort or aggregate on it — a migration, not a redesign (ADR 0004's amendment).

Cash versus card is **not stored**. It is derived from `folderSlot`, so correcting a misfile by
moving the file reclassifies the document instead of leaving a stale column behind.

Two terminal states, **both her action**: confirmed, or not relevant with an optional reason.
Nothing reaches either by inference. A document with no decision is awaiting one, and that is the
count the dashboard reads. Derived status is still computed and shown as a quiet hint alongside her
decision, never overruling it (ADR 0010 and its amendment).

Because she confirms every document regardless of which path produced its data, a document the
parser could not read is a document with an **empty payload she fills in** — not a queue. That is
what retires `receipt_manual_queue`, and it is also the interim state of the deferred OCR path
(ADR 0008's 2026-08-30 amendment), so nothing about it needs redesigning when OCR lands.

### The screen

One route per company-month, listing every document with folders as a **filter** rather than as
navigation. Preview pane, extracted fields beside it, her decision per document, a note.
Historical months render the same component read-only. This is the existing reconciliation screen
with its right-hand column and its pairing controls removed, merged with the month view's folder
grouping and repair panel — not a new screen built from nothing.

### What becomes deletable

Read off the code as it stands, not guessed.

**Tables, `src/lib/db/schema.ts`**

- `pairings` — deleted outright. Nothing replaces it.
- `proofs` — deleted; `documents` is the replacement, and it covers all five processed folders
  rather than the three in `PROOF_FOLDER_SLOTS`.
- `receipt_manual_queue` — deleted; an empty payload replaces it.
- `payments` — reshaped into `documents`. `source` and `blocek_file_id` disappear: the document
  *is* the file, and cash versus card comes from the folder. The eKasa columns — `ekasa_uid`,
  `ekasa_okp`, `ekasa_payload`, `supplier_name`, `dic`, `ico`, `ic_dph`, `kp`, `receipt_number`,
  `recap_base_cents`, `recap_base_literal`, `recap_vat_cents`, `recap_vat_literal`, `amount_cents`,
  `amount_literal`, `currency`, `receipt_at`, `receipt_timestamp_raw` — move into the extracted
  payload. `confirmed_at` becomes the decision columns; `note` stays a column.
- `payment_line_items` and `payment_vat_recap` — deleted as tables; they are per-item and per-rate
  detail that is only ever read whole, which is the definition of payload.
- `receipt_decode_jobs` — deleted as a table; `status` and `failure_reason` become extraction-state
  columns on `documents`, which is where the sweep already looks.
- Migrations: `drizzle/0003_daffy_nicolaos.sql` created the payments and manual-queue tables and
  `drizzle/0006_reconciliation_pairings.sql` created the pairing ones. Whether to add a forward
  migration that drops them or to squash the history is a choice this slice must make explicitly —
  both are safe only because there is no production data.

**Store adapters**

- `src/adapters/store/pairings.ts` — the whole file, 118 lines.
- `src/adapters/store/proofs.ts` — the whole file, 75 lines: `ensureProofsForMonth`,
  `listProofsForMonth`, `getProof`, `updateProofNote`.
- `src/adapters/store/payments.ts` — 426 lines, reshaped. `listManualQueueForMonth`,
  `upsertManualQueueEntry` and `getManualQueueEntry` go outright; `setDecodeJobStatus`,
  `getDecodeJob` and `listPendingDecodeJobsForMonth` collapse into document columns;
  `upsertCashPayment` becomes a payload write; `countUntickedPayments` becomes a count of documents
  awaiting a decision.

**Pure modules**

- `src/modules/reconciliation.ts` — 115 lines, nearly all of it: `PROOF_FOLDER_SLOTS`,
  `ProofFolderSlot`, `ActivePairing`, `isProofFolderSlot`, `isCashPayment`, `derivePaymentStatus`,
  `listUnpairedPaymentWarnings`, `listUnpairedProofWarnings`. Only `countUntickedPayments` survives,
  re-expressed over documents. What is left is small enough to become `DocumentState`.
- `src/modules/month-lifecycle.ts` — the `"pair"` member of `CompanyStage`, and `deriveCompanyStage`
  with it.
- `src/modules/activity-log.ts` — the `Paired` and `Unpaired` event types, their labels, their
  narrowing cases and their renderers. Safe to remove only because no event history exists; with
  real history they would have to stay as read-only vocabulary (ADR 0012).

**Services and views**

- `src/lib/reconciliation/service.ts` — `pairPaymentWithProof`, `unpairPaymentFromProof` and
  `saveProofNote` deleted. `confirmPayment` becomes confirm-document and gains a dismiss sibling;
  `savePaymentNote` becomes the document note.
- `src/lib/reconciliation/view.ts` — the pairing half of the view model: `pairedProofIds`,
  `unpairedProofs`, `pairedProofs`, `unpairedPaymentWarnings`, `unpairedProofWarnings`,
  `pairingIdsByProofId`, `pairingIdsByPaymentId`, `needsPairing`. The rest becomes the document view.
- `src/lib/sweep/views.ts` — `MonthPaymentItem`, `MonthManualQueueItem`, and the `cashPayments`,
  `manualQueue` and `pendingDecodeCount` sections of `buildMonthView`, which merge into the document
  list.
- `src/lib/cash-discovery/discover-cash-payments.ts` — 347 lines, retained but rewired: five
  `upsertManualQueueEntry` calls and two `getManualQueueEntry` guards become extraction-state writes
  on the document, and `upsertCashPayment` writes the extracted payload. The parsing itself is
  untouched.

**UI**

- `src/app/companies/[companyId]/[monthKey]/reconcile/page.tsx` (91 lines) and
  `reconciliation-panel.tsx` (427 lines) merge into
  `src/app/companies/[companyId]/[monthKey]/page.tsx`; the pairing controls, the proof column and
  the two warning lists go.
- `src/app/companies/actions.ts` — `pairPaymentAction`, `pairPaymentFormAction`,
  `unpairPaymentAction` and `saveProofNoteAction` deleted; `confirmPaymentAction` and
  `confirmPaymentFormAction` become confirm-or-dismiss on a document.
- `src/app/companies/page.tsx` — the `formatUnticked` helper and the `/reconcile` link, replaced by
  slice 21.

**Tests and fixtures**

- `tests/unit/modules/reconciliation.test.ts` and `tests/unit/reconciliation/reconciliation-integration.test.ts` — rewritten against `DocumentState`.
- `tests/e2e/reconciliation.spec.ts` — rewritten as the document-screen walkthrough.
- `tests/unit/cash-discovery/cash-discovery-integration.test.ts` — the two `receiptManualQueue`
  assertions become empty-payload assertions.
- `scripts/seed-e2e-reconciliation.ts` — reseeded as documents.

Nothing is lost that was not about pairing. Extraction, the folder taxonomy, the month lifecycle,
Drive mutations and the event log were all built document-first anyway (ADR 0013).

## Acceptance criteria

- [ ] One `documents` row exists per non-deleted file in `01`, `02`, `04`, `05` and `06`, and none for `03` or `07`
- [ ] Workflow fields are columns and extracted data is a JSON payload
- [ ] Her confirmed values are a separate payload; re-running extraction rewrites only the extracted one
- [ ] Cash versus card is derived from the folder slot and is stored nowhere
- [ ] Moving a document between `04` and `05` changes its derived classification with no other action
- [ ] A document can be confirmed, or marked not relevant with an optional reason, and nothing else sets either
- [ ] No code path sets a terminal state by inference
- [ ] The awaiting-decision count reaches zero when every document has a decision
- [ ] Derived status is visible as a hint and never sets or overrides her decision
- [ ] A document whose extraction failed presents an empty, editable payload with the reason shown
- [ ] One route per company-month lists every document, with folders as a filter
- [ ] The preview pane still renders PDF, JPEG and HEIC, HEIC via the existing WASM conversion
- [ ] Notes persist on documents
- [ ] A closed month renders the same screen read-only
- [ ] `/reconcile` no longer exists as a separate route
- [ ] The `pairings`, `proofs`, `receipt_manual_queue`, `payment_line_items`, `payment_vat_recap` and `receipt_decode_jobs` tables are gone from the schema and from the database
- [ ] No file in `src/` references a pairing, a proof or the manual queue
- [ ] The `Paired` and `Unpaired` event types are gone, and the decision to remove rather than retire them is recorded in the slice
- [ ] Migration strategy stated explicitly — forward drop migration or squash — with the no-production-data assumption written down
- [ ] `node --test` passes with no skipped or commented-out tests left behind
- [ ] Integration test: discovery creates documents, two are confirmed and one dismissed, the awaiting count reaches zero
- [ ] E2E: open a company-month, filter by folder, confirm one document and dismiss another, reload and see both persist

## Blocked by

- 06 — eKasa receipt extraction from the text layer
- 09 — Manual pairing, tick and what's-left

## Notes

Slice 09's screen is the input to this one, not a casualty of it. Its preview pane, notes,
read-only closed-month rendering and authoritative-decision behaviour all survive; only the pairing
column is removed.
