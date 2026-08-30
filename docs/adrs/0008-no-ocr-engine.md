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

> **Superseded.** The last paragraph is wrong about the real corpus: every eBloček she has carries
> the UID-only variant, which contains no amount and no timestamp. See the amendment below.

## Decision

**No OCR engine.** Three paths, none of which reads pixels:

1. `02 Prijaté faktúry` — extract text locally with `pdfjs-dist` (free), send the text to a small
   model for field structuring, validate with base + VAT == total.
2. `04` / `05` Bločky — parse the eBloček **text layer** for amount, timestamp and line items. No
   model involved, and no QR decoding. (Originally specified as QR decoding; see the amendment.)
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

**Path 2 is now: parse the eBloček text layer** with `pdfjs-dist`, grouping text items into lines by
y-coordinate. No QR decoding, no page rendering, no `zxing-wasm`, no `@napi-rs/canvas` — which also
restores the single-runtime property below that the canvas dependency had quietly broken.

This is implemented and verified against the real corpus: **all six eBločeks parse, with both
arithmetic checks passing**, and the fourteen non-receipts in those folders are detected and queued
rather than half-parsed.

### What the layout actually looks like

The receipt is a labelled structure, not free text. `NA ÚHRADU <CURRENCY> | <total>` carries the
payable amount with its currency; `SPOLU` is the base/VAT split and is *not* the amount payable.
`Dátum a čas` gives a four-digit-year local timestamp. Each item contributes a name, a VAT rate, a
line total, a quantity and a unit price, followed by a VAT recapitulation with one row per rate.

Four details cost real debugging time and are worth stating, because anything touching this format
will hit them again:

- **Text items must be grouped into lines by y-coordinate.** Flattening `getTextContent()` into one
  string destroys the columns and makes the recapitulation unparseable.
- **Item rows and recapitulation rows are distinguished only by formatting**: an item's rate has no
  space before `%` and its line carries `€` (`23.0% | 4.95 €`); a recap row has a space and no `€`
  (`23.0 % | 28.25 | 6.5`). Position alone is not reliable.
- **The recapitulation drops trailing zeros** — `6.5` where `SPOLU` shows `6.50`. Comparisons must be
  by value in minor units, never by string.
- **Layout varies between vendors.** Some receipts put the rate on the item's own line; some spread
  an item name across several lines, with a name fragment appearing *after* the rate line; OKP hex is
  sometimes lowercase. The parser handles all of these; they were found by running it over the real
  files rather than by reading the specification.

### Unicode normalisation is a correctness concern, not a detail

Every diacritic-bearing folder name in the sample is **NFD**. Compared against NFC canonical names,
six of the seven canonical folders matched nothing and were classified as needing a rename — to a
name that is visually identical. The no-op guard could not catch it either, because the byte
sequences genuinely differ, so she would have confirmed a Drive rename that appeared to do nothing.

Names are therefore normalised to NFC at both boundaries: Drive records as they enter the sweep, and
PDF text as it leaves the extractor. The eBloček parser matches Slovak labels as NFC literals, so an
NFD-emitting PDF producer would otherwise silently match nothing and queue every receipt.

### Two arithmetic self-checks, both verified

The item line totals sum to the payable total, and `SPOLU` base + VAT equals it as well:
`3.09+0.71=3.80`, `35.20+8.10=43.30`, `28.25+6.50=34.75`, `14.72+3.39=18.11`, `8.95+2.06=11.01`,
`0.98+0.22=1.20`. A receipt failing either check produces **no payment** and is queued with the
discrepancy stated. This is a stronger guarantee than the QR ever offered, and it is what this ADR
asks for in its final consequence.

Timestamps are resolved for Europe/Bratislava explicitly and verified across the DST boundary:
`14:36:15` in January becomes `13:36:15Z` (CET) while `14:05:59` in April becomes `12:05:59Z`
(CEST). A fixed offset would have moved a late-evening receipt into the wrong month.

### Still unverified

**Multi-rate receipts.** Slovakia has 23%, 19% and 5% rates, and the parser supports multiple
recapitulation rows, but every receipt in the sample is single-rate 23%. This path has no real
document behind it yet.

### Two further findings the original analysis did not anticipate

- **The `04` and `05` folders are not receipt-only.** Six of twenty PDFs are eBločeks; the rest are
  airline, train and bus tickets, ride-hailing invoices and fuel receipts, and two have no text
  layer at all. Anything that is not an eBloček is detected and queued, never half-parsed.
- **Not everything is in euros.** A FlixBus ticket is priced in Czech koruna. Non-EUR documents
  carry their currency and are flagged for her to supply the euro value; the app does not invent an
  exchange rate. This was not covered anywhere in the PRD. Whether the rate and rate date must be
  recorded alongside the euro value for the tax authority is open — PRD open question 10.

The invoice path (1) and the scan path (3) are unaffected — the 60-of-61 text-layer finding for
received invoices still stands.

### Amendment, 2026-08-30: measured, and the OCR path is wanted but deferred

The "if a client turns out to photograph everything" trigger below was never quantified. It is now,
across all 151 files in the spring corpus. Of the 87 documents in processed folders, **11 have no
usable text layer** — about 13%, or one to two per company per month:

- `02 Prijaté faktúry`: 60 of 61 carry text. Invoice extraction needs no OCR whatsoever.
- `05 Bločky_firemná karta`: 6 of 15 are image-only, every one a `Potvrdenie_*` payment
  confirmation. This is where the gap actually lives.
- `04 Bločky_hotovosť`: 3 phone photos and one image-only PDF out of 9.
- `03 Bankové výpisy`: all 7 fail to open at all, being encrypted — which is why presence is all the
  app can ever report about a statement (ADR 0013).

One to two documents a month does not justify an OCR runtime, so it stays deferred. The caveat is
that spring may be the tidy client: the separate `mix dokladov` pile ran 27 scans out of 40, so the
13% may not generalise. The trigger is therefore real counts across all her clients once the app is
in use, not this one sample.

The intended shape when it does land, so the deferral does not become a redesign:

1. Rules first. If a document parses deterministically, as eKasa receipts do, nothing else runs.
2. Otherwise OCR the image — RapidOCR on ONNX Runtime, as already identified below.
3. Feed the OCR text to a small local model (a ~0.8B Qwen was proposed) to structure it into the
   same JSON payload the rule-based parsers produce.
4. She confirms the result regardless of which path produced it, exactly as she does today.

Because step 4 is unconditional, the interim state is not a gap but a degenerate case of the same
flow: extraction returns nothing and she fills the fields in. The manual path is therefore the
override on an empty payload, not a separate queue — which retires the `receipt_manual_queue` table
built in slice 06.

## Consequences

- The deployment stays single-runtime. This is a large simplification of ADR 0004's box.
- The only paid step is text-to-fields structuring, running on cheap text tokens rather than
  images.
- Receipt amounts are read deterministically from the receipt's own printed total, not inferred by a
  model, and two independent arithmetic checks must agree before a payment exists. (Originally
  claimed as authoritative "because they come from the fiscal code" — the fiscal code turned out to
  carry no amount; see the amendment.)
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
