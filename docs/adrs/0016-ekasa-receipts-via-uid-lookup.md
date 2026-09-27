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
