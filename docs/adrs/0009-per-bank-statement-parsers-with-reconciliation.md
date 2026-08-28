# ADR 0009 — Per-bank statement parsers with a balance reconciliation assert

Date: 2026-08-28
Status: Accepted

## Context

The bank statement is the spine of the entire application (ADR 0002), and it arrives as a
**password-protected PDF**. `qpdf --check` on a real sample returns "invalid password" with an
empty password, so a user password is required — the files cannot be read, rendered or OCR'd
without it. Metadata is encrypted too (`R: 4`, AES-128), so even the producer string is opaque and
the issuing bank cannot be identified from the file.

She holds the password for each client. Statements come from a handful of banks — realistically
3–6 layouts across all her clients.

Structured export (camt.053 or a bank CSV) would make pairing deterministic and was recommended,
but it would require changing what her clients upload. That was rejected in favour of working with
what already arrives.

For turning the decrypted text into rows, the alternative to per-bank parsers was a model with a
strict schema. The parsing cost of the app scales with the number of distinct layouts, not the
number of clients.

## Decision

Decrypt with the **per-company stored password**, then parse with **deterministic per-bank
parsers**. `pdfjs-dist` accepts a password and extracts text in pure JavaScript, so no `qpdf`
binary is required on the critical path.

Every parsed statement is validated by **`reconcile()`: opening balance + Σ movements == closing
balance**, within a cent tolerance. A statement that reconciles is accepted. A statement that does
not is flagged loudly and its payments are excluded from the work list.

Build **one bank end-to-end first**, then add the others.

Passwords are stored per company, encrypted with a key held in the environment rather than in the
database. She is prompted for a new password only when decryption actually fails — banks rotate
them — and never otherwise.

## Consequences

- Parsing is exact and free to run, with no per-document cost and no hallucination risk.
- The reconciliation assert is the single most valuable test in the system. Its real job is not
  catching model error — there is no model here — but catching **a parser drifting silently when a
  bank quietly changes its layout**, which would otherwise poison an entire month of pairing.
- Each new bank is new code and needs a real decrypted sample to write against. This is the main
  ongoing maintenance cost of the design.
- An unsupported bank must be an obvious, named gap in the UI rather than an empty payment list.
- The per-company password is a secret with real consequences; see ADR 0004 for how it is held.
- Blocked on obtaining one decrypted statement per bank. See PRD open questions 2 and 3.

## Alternatives considered

- **Model with a strict schema over the extracted text, gated by the same balance assert.** No
  per-bank code and self-checking, at a fraction of a cent per statement. A reasonable choice;
  determinism was preferred for the one input where a wrong digit is unacceptable. The assert is
  retained regardless, because it is orthogonal to how the text is parsed.
- **Google Document AI Bank Statement parser.** A managed option with unclear Slovak quality and a
  per-page cost.
- **Ask clients to also upload camt.053 / CSV.** Makes pairing exact and removes parsing entirely,
  but changes her clients' habits, which is outside what this project can dictate.
- **Model extraction with her confirming every row.** Rejected: confirming dozens of rows per
  client per month reintroduces the manual work the app exists to remove.
