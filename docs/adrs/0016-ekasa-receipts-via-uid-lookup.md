# ADR 0016 — eKasa receipts are read through their UID and the Finančná správa lookup

Date: 2026-09-27
Status: Accepted
Supersedes: ADR 0008's receipt path (path 2 and its 2026-08-28 amendment) and its "no public API"
consequence
Relates to: ADR 0017 (model and OCR for everything that is not an eKasa receipt), PRD 0002

## Context

ADR 0008 first chose to decode the eKasa QR, then found that every real eBloček carries the
**UID-only** QR variant — an identifier with no amount and no timestamp — and concluded the QR was
"redundant with a strictly weaker version of data already present as text". It replaced the QR
with a text-layer parser and recorded, as a consequence, that "there is no public API for
third-party eKasa lookup".

Both conclusions rested on the same unstated assumption: that the UID is worthless without the
data. The UID is only worthless if nothing will answer for it.

**Something does.** The *Over doklad* web app is backed by a JSON endpoint,
`POST https://ekasa.financnasprava.sk/mdu/api/v1/opd/receipt/find` with `{"receiptId": "<UID>"}`,
and it answers without authentication. Measured on 2026-09-27 against her real corpus:

- **All 16 UIDs tried resolved.** Seven come from the text-layer receipts the existing parser
  already reads; nine were decoded from scans and phone photos that nothing reads today.
- **For the seven, the lookup agrees with the parser field for field**: total, timestamp to the
  second, IČO, DIČ, IČ DPH, and base and VAT per rate.
- The response carries the supplier's full identity and address (`organization`), the cash-register
  unit, the receipt number and every item with its gross price, VAT rate and item type.
- **Only curl's default User-Agent is refused** — the gateway returns HTTP 499 "Request Rejected".
  An honest `hugo-accounting/0.1` and Node's default are both answered. Nothing has to pretend to be
  a browser.
- **The per-rate summary fields are `null` at 23%.** `taxBaseBasic`, `vatAmountBasic` and their
  siblings were shaped for the pre-2025 20/10 rates and are empty on every receipt tried. Base and
  VAT per rate must be computed from the items (gross price and rate); done that way, all seven
  match the printed recapitulation exactly. Items include discounts (`itemType` `Z`), and the rate
  is sometimes `23` and sometimes `23.0`.

The image-only documents are where this pays. ADR 0008's 2026-08-30 amendment counted 11 documents
with no usable text layer and deferred OCR for them. Of the 12 image-only and photographed documents
in the current corpus, a QR decoder alone reads the UID from **8**: every `Potvrdenie_*` scan
that is a receipt, `2026-07-20_190652`, `Hudy Bratislava`, `nákup PHL` and two phone photos (one
HEIC). Each decode took under a second on a 5088×7008 page image. Of the other four:

- `IMG_3440.jpeg` is a Slovnaft receipt whose QR the thermal printer damaged — white streaks
  through the modules, undecodable at any scale or crop. The UID is **printed legibly** above it,
  and that UID resolves.
- `Potvrdenie_2026-07-24_101946` and `parkovné` are **parking-machine receipts with no eKasa code
  at all**. Sales through a payment machine are generally not registered in eKasa, so "every Slovak
  receipt carries a QR" is not true of them.
- `Potvrdenie_2026-06-16_221033` is an invoice carrying a **PAY by square** payment QR. The
  `Potvrdenie_` prefix is her scanner app's naming, not a document type.

Two more details surfaced by decoding real codes:

- **A receipt can carry more than one QR.** The Slovnaft receipt has a marketing QR for the
  Slovnaft Move app above the eKasa one. "The first QR found" is the wrong rule.
- **A QR's content is not always the bare UID.** The one on `2026-07-20_190652` reads
  `V-F0B6…BBOKP: 5f51…` — the OKP glued on after the UID.

## Decision

**For any eKasa receipt, the Finančná správa lookup is the source of the data.** The receipt's own
text layer is a fallback.

### Finding the UID

The UID is looked for in this order, and the first hit wins:

1. **The PDF text layer**, already extracted for every PDF.
2. **QR codes in the document's images** — the page images embedded in a scanned PDF, extracted
   through pdfjs's operator list without a canvas dependency, and phone photos directly (HEIC
   through the existing WASM conversion). Decoding uses `zxing-wasm`, so no native build is added.
3. **The OCR text**, when OCR runs at all (ADR 0017). This is what rescues `IMG_3440`.
4. **A UID box on the fields panel**, where she types or pastes the 34 characters. The lookup then
   fills the document. A typo does not slip through: a wrong UID simply returns "not found".

**Relevance is decided by content, never by position.** A QR counts only if it contains an eKasa
UID, matched as a search (`/[OV]-[0-9A-F]{32}/i`) rather than a whole-string match, or the
offline OKP variant. Every other code — marketing links, PAY by square, anything else — is ignored.
PAY by square was considered as a cross-check for invoices and dropped: it is a shortcut for
banking apps, and on the one real sample its amount field is `0`.

### Calling the lookup

`EkasaLookup` is a port with one HTTP adapter:

- An honest `User-Agent` naming the app. No browser impersonation.
- **One request at a time.** At a few dozen receipts a month there is nothing to parallelise.
- **Cached forever.** A fiscal receipt does not change; the raw response is stored on the document,
  which is both the cache and the audit trail.
- **Validated before it counts**: the returned `receiptId` must equal the UID asked for, and the
  item prices must sum to `totalPrice`.
- Base and VAT per rate are **computed from the items**, in minor units, and rates are normalised
  (`23` and `23.0` are one rate).

The result maps into the same `kind: "ekasa"` payload the text-layer parser already produces, with
a `source` of `lookup` or `text-layer`, so the fields panel and everything after it cannot tell the
paths apart. Data the lookup returns goes into the **extracted** payload, never the confirmed one:
it is machine-read, and she still reviews it (ADR 0010).

### When it fails

- **Unreachable, refused, or not found** (an offline receipt can take up to about 48 hours to
  reach Finančná správa): the text-layer parser runs if the document has a text layer.
- **Nothing produced a payload**: an empty payload with the reason stated, which she fills in —
  the same degenerate case ADR 0008's amendment already established. Nothing blocks and nothing is
  queued separately.
- **No UID found anywhere**: the document is not treated as an eKasa receipt. It goes to the model
  path (ADR 0017), which is where payment-machine, foreign and Czech receipts belong.

## Consequences

- **The app now depends on an undocumented government endpoint.** It can change shape, add a
  captcha, or block the server's address without notice. Because she confirms every document
  regardless, that costs convenience and never data: the app degrades to today's behaviour.
- **eKasa receipts need no OCR and no model.** On the corpus, 9 of the 12 documents that no parser
  reads today get complete data this way, including line items, which the model path deliberately
  does not produce (ADR 0017).
- **The existing text-layer parser stays** — it is built, tested against the real corpus and works
  offline — but it is no longer the main path. Its four hard-won layout findings (ADR 0008) remain
  valid for it.
- **Multi-rate receipts are covered by computation, not by a printed summary.** ADR 0008 listed
  multi-rate receipts as unverified; the lookup path computes each rate from the items, so the
  remaining risk is rounding across items, which the item-sum check catches.
- The **OKP (offline) QR variant is still unverified**. No receipt in the corpus carries one, and
  whether the lookup answers for it the same way is untested.
- **A Czech receipt never takes this path.** Czech EET was abolished in 2023, so Czech receipts
  carry no fiscal code and go to the model (ADR 0017, ADR 0018).
- One new dependency, `zxing-wasm`, compiled to WASM like `heic-convert`. The prototype encoded
  page bitmaps with `sharp` for the decoder; the implementation must feed the decoder without
  reintroducing a native dependency.

## Alternatives considered

- **Keep the text layer as the main path and use the lookup only for scans and photos.** Keeps
  text-layer PDFs fully offline. Rejected because the lookup is the fiscal record itself, and one
  primary path is simpler than two that must agree.
- **OCR every receipt and parse the printed text.** Solves the harder problem to reach data the
  fiscal system already holds in structured form, with OCR's digit errors on top.
- **Decode PAY by square on invoices too.** Deterministic IBAN, VS and due date, but it is a banking
  convenience rather than an accounting record, and its amount can be `0`. Dropped by her decision.
- **Ask her to type the fields for damaged receipts.** Seven or eight fields instead of one UID,
  with no self-check. The UID box is strictly less typing.

## Amendment, 2026-09-27: cash rounding, and VAT per rate rather than per item

Building private fixtures from her real receipts overturned two details of the lookup mapping.

**Cash totals are rounded by law, so "the items sum to `totalPrice`" is wrong for cash.** Two of
the nineteen recorded receipts were rejected: OMV (19.83 of fuel, `totalPrice` 19.85) and Slovnaft
(40.01, `totalPrice` 40.00), both in `04 Bločky_hotovosť`. Since 1 July 2022 a Slovak cash payment's
final amount is rounded to the nearest 5 cents, and the rounding is not part of any VAT base. Every
rounded cash receipt was therefore falling through to an empty form.

The rule now lives in one pure module, `cash-rounding`, and every place that compares base and VAT
with a total uses it:

- **EUR**: to the nearest 5 cents. **CZK**: to the nearest whole koruna, half up — the Czech rule
  since the haléř coins were withdrawn.
- **The rule follows the currency the receipt was paid in**, not the buyer's country: rounding
  happens at the till under the shop's law, so a Czech company's cash receipt from Bratislava is in
  EUR and rounded the Slovak way. For her clients the two coincide almost always; keying by currency
  keeps the cross-border case right as well.
- A total is accepted when it equals base + VAT exactly (card) **or is exactly its legal cash
  rounding**. Any other difference is still a mismatch, so a misread digit is not waved through.
- **The rounding is derived, never stored**: total minus base and VAT per rate. It follows her edits
  in the fields panel, which shows it as its own line, and the export writes it as *halierové
  vyrovnanie* (ADR 0019).

**Base and VAT are computed once per rate, not per item.** The first version rounded each item's VAT
and added them up, which drifted by a cent on multi-item receipts — IKEA, four items, base 8.94
against the printed 8.95. Summing the gross per rate and splitting it once, as the cash register
does, matches the printed recapitulation on all ten text-layer receipts in the corpus.

The text-layer parser's checks accept the same rounding, though no rounded text-layer receipt exists
in the corpus yet — every text-layer eBloček sits in the card folder — so that path is covered by a
synthetic test only.

## Amendment, 2026-09-27: damaged codes, re-reading old failures, and a pdf.js trap

**Scans never reached the QR step inside the app.** pdf.js takes ownership of the buffer it is
given and leaves the caller's empty. The pipeline reads a scan twice — its text layer, then its page
images for the QR code — and the second read threw `DataCloneError`. Discovery had no per-document
error handling, so that one throw also abandoned every later document of the month. Tests passed
because each read its file fresh. Every read now gets its own copy, and a document that throws is
recorded as failed with the error while discovery moves on.

**Old failures are re-read when the pipeline improves.** Discovery skipped any document already
attempted, so a scan that failed "no extractable text layer" before QR decoding existed stayed failed
for good. Each attempt now records `EXTRACTION_PIPELINE_VERSION`; a document that failed under an
older version is read once more, and a complete one never is. On her data this turned seven stale
failures — every `Potvrdenie_*` receipt scan, `2026-07-20_190652`, `Hudy Bratislava`, `nákup PHL` —
into complete lookups.

**Print-damaged codes are recoverable after all.** `IMG_3440`'s eKasa QR, which a phone camera reads,
decodes once the printer's light streaks are closed: each pixel darkened to the darkest of its 3–5
neighbours across the streak. The streak direction depends on how the receipt lies in the photo, so
both axes are tried, after the contrast stretch and before a half-size copy. Photos are decoded to
pixels with `jpeg-js`, pure JS. The retries run only after a plain decode fails, and they continue
until an **eKasa** code turns up — a Slovnaft receipt's intact marketing QR used to stop them.

**What the new `mix dokladov` pile shows** (40 scans): 18 hold one eKasa receipt, 13 none (invoices, a
Hornbach receipt printed without a code, statements), and **9 hold several receipts** — up to three
on one page — which the one-UID-per-file rule still flags rather than splits. One receipt appears in
two different files. Neither case is solved here.

The multi-receipt and duplicate cases above were resolved the same day: see ADR 0013's amendment,
*one document per receipt*.
