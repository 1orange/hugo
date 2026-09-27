# 02 — Receipts from scans and photos via their QR code

Type: AFK
Status: ready-for-agent
User stories: 2, 3, 6

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

Scanned and photographed eBločky stop being blank forms. For a document with no text layer — an
image-only PDF, a JPEG, a HEIC photo — in any processed folder, the app reads the QR codes in its
images, picks the one that holds an eKasa UID, and hands the UID to the lookup from slice 01.

End to end: page images are pulled out of scanned PDFs through pdfjs's operator list, with no
canvas; JPEGs are read directly and HEIC through the existing WASM conversion; `QrReader` decodes
every QR on the image with `zxing-wasm`; `EkasaUid` keeps a code only if its **content** is an eKasa
UID (or the offline OKP variant) and ignores everything else — marketing links, PAY by square. The
lookup then fills the document exactly as in slice 01. If the first decode finds nothing, one retry
runs at a reduced resolution (the `nákup PHL` scan only decoded that way).

Documents with no eKasa code at all — the two parking-machine receipts, the PAY by square invoice,
any Czech receipt — keep an empty payload with the reason "no eKasa code found". Slice 13 picks them
up with OCR later.

The prototype of this path used `sharp` to encode page bitmaps for the decoder. The implementation
must feed `zxing-wasm` without adding a native dependency; ADR 0016 keeps the app buildable with no
native toolchain.

## Acceptance criteria

- [ ] Page images are extracted from an image-only PDF without a canvas or any native dependency
- [ ] JPEG photos are decoded directly and HEIC photos through the existing WASM conversion
- [ ] `QrReader` wraps `zxing-wasm` behind a port with a fake; no native dependency is added to the project
- [ ] Every QR on an image is considered; the eKasa one is chosen by content, and marketing and PAY by square codes are ignored (the Slovnaft receipt carries both kinds)
- [ ] A decode that finds nothing retries once at reduced resolution
- [ ] A file whose images hold two different eKasa UIDs is flagged for her rather than silently using one
- [ ] Against the private corpus: 8 of the 12 image-only and photographed documents resolve through the lookup; the two parking-machine receipts and the PAY by square invoice report "no eKasa code found"
- [ ] A 5088×7008 scanned page decodes in about a second on the Mac, reported by the corpus check
- [ ] The workbench shows the document as being read while it is pending, and the source badge afterwards
- [ ] Integration test: an image-only PDF with the fake QR reader and fake lookup ends with a `lookup` payload

## Blocked by

- 01 — Text-layer eBločky read through the OPD lookup
