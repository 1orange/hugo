# ADR 0013 — Document-centric domain model

Date: 2026-08-30
Status: Accepted
Supersedes: ADR 0002 (payment-centric domain model)

## Context

ADR 0002 made the `Payment` primary and reasoned that documents-primary "makes 'what's left' a file
count, which is not the question she is asking". That was correct given the workflow described at
the time, in which the app performed the pairing.

The requirement changed: **pairing happens in Omega, not here.** The app is not asked to read bank
statements at all. What it is asked to do is process the proof — extract its data so she does not
retype it — and to show that clients are actually uploading, so she knows whom to chase without
opening seven Drive folders.

That removes the reason payments were primary. The statement is no longer an input to be parsed; it
is a file whose *presence* is the signal. And "what's left" genuinely is a document count now,
because each document needs a decision from her and nothing else does.

The corpus also settled a question the old model leaned on. ADR 0002 asserted that "card receipts
in `05` pair against statement lines, because a card transaction appears on the statement", making
cash and card structurally different. In the real sample **no document states how it was paid** —
the only candidate line on an eKasa receipt is `NA ÚHRADU EUR`, which is the amount due, not a
method. Worse for the old framing, all six eBločeks in the sample sit in `05 Bločky_firemná karta`
and `04 Bločky_hotovosť` contains none: the slice built as "cash bločky" has only ever parsed card
receipts. The cash/card distinction exists solely as her filing decision.

## Decision

The **`Document` is the primary entity** — one per proof file in a processed folder.

Cash versus card is **derived from the folder the document sits in**, never parsed from its
contents and never stored as a field. The folder is the only signal that exists, it is already
recorded as `folderSlot`, and deriving means that when she corrects a misfile by moving the file,
the classification follows instead of going stale. The distinction survives only because it decides
the target ledger on import, a till purchase and a card purchase being different documents in
Omega.

Pairing is removed: no `Payment`, no `Proof`, no `pairings` join, no match suggestions.

Bank statements are **presence-only**. The app reports that a statement arrived and when, and never
opens one. They stay encrypted and unread, which is why ADR 0009 is withdrawn rather than amended.

Processed folders are `01`, `02`, `04`, `05` and `06`. `03` is presence-only and `07 Mzdy` is out of
scope. Issued invoices are included because she books revenue from them too, and they are 39 of the
sample's 151 files with clean text layers throughout.

A document reaches exactly one terminal state, and **both are her decision**: confirmed, or not
relevant. Nothing marks a document done on its own. "What's left" is the count of documents awaiting
her decision, which is therefore able to reach zero.

Extraction is layered: the workflow fields the app queries are columns, and everything a parser
produces is a JSON payload. Her confirmed values are stored separately from the extracted ones, so
improving a parser cannot overwrite what she typed.

## Consequences

- The model shrinks. Two tables and a join disappear, along with statement decryption, per-bank
  parsers, the balance-reconciliation assert, encrypted password storage and its key management, and
  auto-matching. Removing the password store removes the only secret the app held.
- The primary screen is one company-month document list, folders acting as a filter. The month view
  and the reconciliation view collapse into it.
- The company list becomes the landing dashboard, answering both daily questions at once: whom to
  chase, and what is left to process.
- The export becomes the finish line rather than a downstream nicety, and it must cover issued as
  well as received documents. ISDOC handles received invoices only, so the other types still need
  the TXT path.
- Nothing is lost by the reversal in practice: extraction, the folder taxonomy, month lifecycle,
  Drive mutations and the event log were all built document-first anyway. The discarded work is the
  pairing UI and its schema.
- The app now holds no interpretation of a bank statement, so it can never be wrong about one. It
  can only be wrong about whether a file exists.

## Alternatives considered

- **Keep `Payment` and hide the pairing UI.** Cheapest immediately, but leaves a schema shaped
  around a workflow that no longer exists, and every later feature pays for the mismatch.
- **Keep cash and card as separate document types.** Rejected because nothing in a document
  distinguishes them; only her filing does, and that is already recorded.
- **Parse statements anyway, to cross-check that uploaded proofs cover the month's spending.**
  Attractive, and exactly what ADR 0009 was built for, but it reintroduces decryption, stored
  passwords and per-bank parsers to produce a hint she has not asked for and Omega already gives
  her.
