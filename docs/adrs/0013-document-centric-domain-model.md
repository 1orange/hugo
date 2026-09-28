# ADR 0013 — Document-centric domain model

Date: 2026-08-30
Status: Accepted; amended by ADR 0019, 2026-09-27

> ADR 0019 removes the cash-versus-card distinction. It survived here "only because it decides the
> target ledger on import"; she now decides that in Omega, and the export's section is chosen by the
> document's type rather than its folder. Everything else below stands.
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

## Amendment, 2026-09-27: one document per receipt, not per file

"The `Document` is the primary entity — one per proof file" held until real scans arrived. Clients
scan several receipts onto one page: of the 40 files in `mix dokladov`, **9 hold 20 receipts between
them**, up to three per page (Stabilit next to an Orlen fuel receipt; Betis rental, Garost and HQ
Tools on one sheet). Each is a separate accounting document in Omega, so one document per file either
lost all but one receipt or — under the flag-a-conflict rule — lost them all.

**A document is now one proof, and a file can carry several.** `documents` has its own `id`:

- The file's own document keeps the **Drive file ID as its ID**, so every existing document and
  every single-receipt file is unchanged.
- Each further eKasa receipt found in the file is a sibling with ID **`<file>#<UID>`** and its
  `receipt_uid` set — stable across re-reads because the UID is. On a re-read the file's own document
  keeps the UID it already holds.
- Each sibling has its own lookup data, decision, confirmed values, note and export number, and
  previews the same file. A sibling whose lookup fails still exists, with its UID, for her to fill in.
- Moving the file moves all its documents; the folder remains the only thing they share.

The workbench shows *bloček 2 z 3*. Decisions, fields, notes, the UID box and the export all key on
the document; only the preview and the Drive link use the file.

**The same receipt is booked once.** One receipt appears in two files of the pile (`O-5EA6…D41C`).
Documents sharing an eKasa UID — in any month — are flagged on both sides, and the export holds back
any receipt whose UID is already in another included or exported document, naming it. Which copy to
keep stays her decision: she marks the other not relevant (ADR 0010).

Only eKasa receipts are split, because only they carry an identifier per receipt. A scan of several
non-eKasa receipts is still one document.
