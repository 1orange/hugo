# ADR 0002 — Payment-centric domain model

Date: 2026-08-28
Status: Accepted

## Context

The feature list read like a document-processing app: mark files processed, OCR them, move them,
export them, and — last on the list — pair them to bank payments.

Interrogating the actual workflow inverted that. Her process is: read the bank statement, and for
each payment line find the document that proves it. A payment with a proof can be used in the
company's accounting. A payment without one cannot. Omega receives the payments; the proof PDFs
stay in Drive as the 10-year legal archive.

Modelling documents as primary and pairing as a feature would have produced the wrong schema, the
wrong screens, and the wrong definition of "done".

## Decision

The **`Payment` is the primary entity.** It has two sources:

- a line from a bank statement, or
- a cash bloček from `04 Bločky_hotovosť` — a payment made from the till, which arrives already
  carrying its own proof.

A `Proof` is a document that substantiates a payment. Pairings are **many-to-many**: one transfer
can settle three supplier invoices, and one invoice can be settled by several installments. The
join table carries how the pairing was created (`auto` | `manual`), a confidence and a reason.

Card receipts in `05 Bločky_firemná karta` pair against statement lines, because a card
transaction appears on the statement. Cash bločky never pair, because they never will.

"Work remaining" for a month is a count over payments, not over files.

## Consequences

- The primary screen is a reconciliation view, not a folder browser. Folders become a filter.
- Anything unpaired in either direction is a warning she resolves. The app does not attempt to
  infer deductibility or apply Slovak tax rules; reason codes were explicitly rejected as
  pretending to knowledge the app does not have.
- Many-to-many costs a join table instead of a foreign key — the same effort at build time, and it
  avoids re-modelling the core later.
- The bank statement becomes the single most critical input in the system. Every downstream
  feature depends on parsing it correctly, which is why it gets its own reconciliation assert.
  See ADR 0009.

## Alternatives considered

- **Document-primary with a pairing field.** Matches the original feature list and the folder
  structure, but makes "what's left" a file count, which is not the question she is asking.
- **One-to-one pairing until proven insufficient.** Rejected: collective supplier payments and
  installments are both normal, so the rework was near-certain and the saving was one table.
- **Separate entities for bank payments and cash documents.** Rejected: they answer the same
  question and reach Omega the same way. One `Payment` with a `source` discriminator is smaller.
