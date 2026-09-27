# 01 — Text-layer eBločky read through the OPD lookup

Type: AFK
Status: ready-for-agent
User stories: 1, 7, 8, 9

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The first end-to-end slice of ADR 0016. A receipt whose text layer contains an eKasa UID is read
from Finančná správa's *Over doklad* endpoint rather than from its own printed text, and the
existing text-layer parser becomes the fallback.

End to end: discovery reads the text layer as it does today; `EkasaUid` finds the UID by search in
those lines; the `EkasaLookup` port asks the OPD endpoint; `EkasaLookupMapping` turns the response
into the same `kind: "ekasa"` extracted payload the parser already produces, now with
`source: "lookup"`; the workbench shows where the data came from. If the lookup is unreachable,
refused, returns nothing, or fails validation, the text-layer parser runs exactly as today and the
payload says `source: "text-layer"`. If both fail, the document gets an empty payload with the
reason, which she fills in.

The mapping computes base and VAT per rate from the items, in minor units, because the response's
own per-rate fields are `null` at 23%. Rates are normalised (`23` and `23.0` are one rate) and
discount items (`itemType` `Z`) count. A response whose `receiptId` differs from the UID asked for,
or whose items do not sum to `totalPrice`, is rejected.

The adapter sends an honest User-Agent naming the app (curl's default is refused with HTTP 499;
`hugo-accounting/0.1` is answered), makes one request at a time, and stores the raw response inside
the payload — which is both the cache and the audit trail, since a fiscal receipt never changes.

This slice also establishes the **private-fixtures convention** for the whole PRD, because it is the
first to use recorded real data: real OPD responses live in a directory excluded by `.gitignore`;
committed tests use synthetic responses; tests that need private fixtures skip with a clear message
when the directory is absent.

## Acceptance criteria

- [ ] `EkasaUid` finds a UID by search in text lines, including one with the OKP glued on (`V-…BBOKP: …`), and rejects strings that only look similar
- [ ] The `EkasaLookup` port has an HTTP adapter and a hand-written fake; no test calls the real endpoint
- [ ] The adapter sends an app-identifying User-Agent and never more than one request at a time
- [ ] Per-rate base and VAT computed from items equal the printed recapitulation for the seven real text-layer receipts (private fixtures)
- [ ] `23` and `23.0` are treated as one rate; a discount item reduces the total; a mismatched `receiptId` or item sum is rejected
- [ ] The payload records `source: "lookup"` or `source: "text-layer"`, and the raw OPD response is stored on the document
- [ ] A document that already has a stored lookup response is not looked up again
- [ ] Lookup failure of every kind falls back to the text-layer parser; both failing leaves an empty payload with the reason stated
- [ ] Lookup data lands in the extracted payload only; her confirmed payload is never touched, and her corrections survive a re-read
- [ ] The workbench shows the source of a document's data
- [ ] An extraction event is recorded with its source
- [ ] A private-fixtures directory is excluded by `.gitignore`; `node --test` passes on a clean checkout without it
- [ ] Integration test: discovery on a text-layer receipt with the fake lookup produces a `lookup` payload; with a failing fake it produces a `text-layer` payload

## Blocked by

None - can start immediately
