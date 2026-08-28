# ADR 0008 — No OCR engine: text layer plus eKasa QR

Date: 2026-08-28
Status: Accepted

## Context

Reading document data was assumed to require OCR. Several options were weighed: a hosted vision
model, Google Document AI, Mistral OCR, and self-hosted PaddleOCR.

Self-hosting was attractive on cost grounds until the numbers were checked. At roughly 450 pages a
month, Mistral OCR at $1/1000 pages is about **€0.45/month** and a hosted vision model under
**€0.20/month**. A GPU box capable of serving a 7B vision model is €150+/month, and CPU inference
is minutes per page. Fine-tuning was also raised, but a fine-tune needs hundreds of *labelled*
Slovak invoices, and the only person who can label them is the accountant — spending her hours to
save roughly €20 a year.

More importantly, OCR solves the cheap half of the problem. It converts pixels to text. It does
not produce IČ DPH, tax base per rate, delivery date, variabilný symbol or IBAN from an unbounded
set of supplier layouts. That structuring step is the actual product.

Then the corpus was measured, and it removed the need for OCR almost entirely.

**Of the 61 received invoices in the spring sample, 60 carry a text layer.** One is a scan.

The 40 documents in `mix dokladov` are 27 scans to 13 text-layer — but those are receipts, and
receipts turned out to have a better path than OCR. Receipts arrive predominantly as eBločky, and
the **eKasa QR code is fully specified by Finančná správa**: it encodes either the 34-character
receipt UID, or OKP (44 chars) + register code (16–17) + timestamp as `YYMMDDHHMISS` + sequence
number + **total amount**. Amount and timestamp — exactly the pairing key — come from the fiscal
code, not from reading anything.

## Decision

**No OCR engine.** Three paths, none of which reads pixels:

1. `02 Prijaté faktúry` — extract text locally with `pdfjs-dist` (free), send the text to a small
   model for field structuring, validate with base + VAT == total.
2. `04` / `05` Bločky — decode the eKasa QR from the PDF for amount and timestamp. No model
   involved.
3. The rare scan — she enters it by hand.

No PaddleOCR, no RapidOCR, no Python sidecar, no second runtime on the VPS. The Node application
does all of it.

### Amendment, 2026-08-28: the receipt path was wrong, and the text layer replaces it

Implementing slice 06 and then measuring the real corpus overturned path 2 above. The reasoning here
was sound but rested on an untested assumption about which QR variant Slovak POS systems actually
print.

What the six real eBločeks in the spring sample show:

- **All of them carry the UID-only QR variant**, which by specification holds no amount and no
  timestamp. The claim above that "amount and timestamp come from the fiscal code" is false for this
  corpus. Decoding the QR yields an identifier and nothing else, so every receipt would have gone to
  manual entry — the opposite of the intended outcome.
- The QR is **drawn as vector paths**, not embedded as an image, so decoding it needs a full page
  render. That pulled in `@napi-rs/canvas`, a native dependency this ADR had ruled out, to obtain
  data that turned out to be worthless.
- **The text layer already contains everything**, in a regular labelled structure: the total with an
  explicit currency on the `NA ÚHRADU` line, a four-digit-year local timestamp, per-item name, VAT
  rate, quantity and unit price, a VAT recapitulation per rate, and the UID and OKP themselves.

The QR was therefore redundant with a strictly weaker version of data already present as text.

**Revised path 2:** parse the eBloček text layer with `pdfjs-dist`, grouping text items into lines
by y-coordinate. No QR decoding, no page rendering, no `zxing-wasm`, no `@napi-rs/canvas`. This also
restores the single-runtime property below, which the canvas dependency had quietly broken.

Two independent arithmetic self-checks are available and hold on all six samples: the item line
totals sum to the payable total, and base + VAT equals it as well. This is a stronger guarantee than
the QR ever offered, and it is what this ADR asks for in its final consequence.

Two further findings, neither of which the original analysis anticipated:

- **The `04` and `05` folders are not receipt-only.** Six of twenty PDFs are eBločeks; the rest are
  airline, train and bus tickets, ride-hailing invoices and fuel receipts, and two have no text
  layer at all. Anything that is not an eBloček must be detected and queued, never half-parsed.
- **Not everything is in euros.** A FlixBus ticket is priced in Czech koruna. Non-EUR documents
  carry their currency and are flagged for her to supply the euro value; the app does not invent an
  exchange rate. This was not covered anywhere in the PRD.

The invoice path (1) and the scan path (3) are unaffected — the 60-of-61 text-layer finding for
received invoices still stands.

## Consequences

- The deployment stays single-runtime. This is a large simplification of ADR 0004's box.
- The only paid step is text-to-fields structuring, running on cheap text tokens rather than
  images.
- Receipt amounts are authoritative rather than inferred, because they come from the fiscal code.
- There is no public API for third-party eKasa lookup — verification exists only as the
  `Over doklad` web app and the ePeňaženka mobile app — so a receipt's VAT breakdown and supplier
  must still come from its own text layer. See PRD open question 6.
- The extraction benchmark is re-scoped: the corpus to label is spring's 61 received invoices, not
  the 40 in `mix dokladov`, and only one step is being scored — text to fields.
- If a client turns out to photograph everything, this decision is revisited. The recommended
  re-entry point is RapidOCR (PP-OCR models on ONNX Runtime, ~50–80 MB, Slovak supported via
  `latin_PP-OCRv5_mobile_rec`) rather than PaddleOCR itself (~500 MB with the PaddlePaddle
  framework).
- Both model-touching paths carry an arithmetic self-check, because a misread digit in an amount is
  invisible downstream. Base + VAT == total is to extraction what the balance assert is to
  statement parsing.

## Alternatives considered

- **Hosted vision model on every page.** Simplest single pipeline, ~€0.20/month. Unnecessary once
  it emerged that almost every invoice already carries extractable text.
- **PaddleOCR or RapidOCR locally.** Legitimate — Slovak is explicitly supported — but it replaces
  a nearly-free text extraction with a Python sidecar, and does not address field structuring.
- **Self-hosted OCR plus deterministic rules, no model at all.** Removes the external dependency
  but requires per-supplier rules across an unbounded and changing set of layouts.
- **Fine-tuning a small model.** Costs her labelling hours to save roughly €20 a year, and 40
  documents cannot train anything.
