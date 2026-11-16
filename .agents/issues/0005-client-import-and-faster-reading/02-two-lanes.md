# 02 — Documents that need no model don't wait for it

Type: AFK
Status: done

## What to build

Today one queue reads a document from start to finish, with one global concurrency
(`EXTRACTOR_CONCURRENCY`, 1). So a receipt with an eKasa code, or an invoice carrying its own ISDOC
or MOL data, waits behind every model read ahead of it. In production, 52 of the last 100 jobs needed
under 10 s, but queued behind model reads of 49 s median and up to 6 min. The next document's OCR
cannot start while the model is busy either.

Split reading into two lanes:

- **Reading lane**, several at once (`READ_CONCURRENCY`, default 3). It downloads the file and does
  everything that is not the model: text layer, ISDOC/MOL, QR, eKasa lookup, OCR. A document that
  needs nothing more is finished here.
- **Model lane**, limited to the model server's slots (`EXTRACTOR_CONCURRENCY` until slice 03). A
  document that needs the model is handed over with the text lines the model is to read. The model
  lane neither downloads it again nor runs OCR again.

Each document is still one job per file in each lane (ids from the Drive file id), so a document
queued twice is still read once. The guarantees stay where they are:

- A re-read keeps its earlier result until a new one is written.
- A replacement commits in whichever lane finishes the document.
- A model or OCR outage makes the document wait in its own lane.

*Spracovanie* shows both lanes. Its stage labels say which one a document is in.

## Acceptance criteria

- [ ] With the model busy on a long document, an eKasa receipt and an ISDOC invoice queued after it finish without waiting for it (integration test with a slow fake extractor).
- [ ] OCR of one document runs while the model reads another.
- [ ] A document queued twice, from either lane, is read once.
- [ ] A re-read and a replacement keep their current commit and rollback behaviour (existing tests pass, plus one per lane).
- [ ] A model outage leaves documents waiting in the model lane, and the reading lane keeps finishing others. An OCR outage does the reverse.
- [ ] The queue view, service monitor and graceful worker shutdown cover both lanes.
- [ ] `READ_CONCURRENCY` is documented in the deploy README, and in the config map in the flux repository.

## Blocked by

None - can start immediately
