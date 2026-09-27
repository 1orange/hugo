# 13 — OCR for image documents

Type: AFK
Status: ready-for-agent
User stories: 12, 13

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The last resort of the pipeline (ADR 0017): documents with neither a text layer nor an eKasa QR —
parking-machine receipts, scanned invoices, every Czech receipt — are read by OCR and then by the
model.

End to end: RapidOCR (PP-OCR models on ONNX Runtime, Latin recognition covering Slovak and Czech
diacritics) joins the `docker compose` file as a small HTTP service behind an `Ocr` port. The app
sends page images — the same ones slice 02 extracts — or the photo. `OcrLines` groups the returned
boxes into lines by y-coordinate with `|` between cells, the shape `pdf-access.ts` produces, so the
model sees one input format. The OCR text is **searched for an eKasa UID first**: a damaged QR with
a legible printed UID, as on `IMG_3440`, resolves through the lookup. Only when no UID is found does
the text go to the `Extractor` and the checks.

The harness gains the image documents, among them the Grand hotel scan — the corpus's first real
multi-rate document, 5% and 23% — and the two parking-machine receipts, and reports OCR time
separately from model time.

## Acceptance criteria

- [ ] RapidOCR runs as a service in the same `docker compose` file, behind an `Ocr` port with a fake
- [ ] `OcrLines` produces lines in the `pdf-access.ts` shape, covered by unit tests
- [ ] OCR runs only for documents with no text layer and no QR-decoded UID
- [ ] A UID found in OCR text goes to the lookup; `IMG_3440` resolves this way against the private corpus
- [ ] Otherwise the OCR lines go to the `Extractor` and the checks, with `source` recording OCR plus model
- [ ] The harness includes the image documents and reports OCR and model time separately
- [ ] An unreachable OCR service leaves documents pending, as for the model
- [ ] Integration test: an image document with fake OCR text holding a UID ends with a lookup payload; one without ends with a checked `extracted` payload

## Blocked by

- 12 — The Extractor in the app
- 02 — Receipts from scans and photos via their QR code
