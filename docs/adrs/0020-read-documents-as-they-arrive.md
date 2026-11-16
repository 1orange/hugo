# ADR 0020 — Read documents as they arrive: Drive push, a slow poll, one queue

Date: 2026-09-29
Status: Accepted. Supersedes ADR 0003's "no scheduler" and its dashboard-load channel renewal; the
sweep stays the one ingestion path. Amended by ADR 0021: the queue, the poll and the notification
debounce live in Redis (BullMQ), shared by every replica, instead of in process memory.

## Context

ADR 0003 rejected a scheduler because state only had to be correct when she looked at it, on a
monthly cadence. That held while reading a document was cheap. With the local model (ADR 0017) an
invoice costs ~50 s of CPU on the M4 and more on the deployment node, so a month-start batch of a
few hundred documents is hours of work — and it started only when she opened the app, from page
renders that restarted in-flight documents on every 1.5 s refresh.

The webhook ADR 0003 described was never built; nothing ran in the background.

## Decision

- **One queue per process** reads each document at most once at a time, as many at once as the
  model server has slots (`EXTRACTOR_CONCURRENCY`, default 1). Pages only queue work.
- **Drive push.** With `DRIVE_WEBHOOK_URL` set (the app's public HTTPS URL +
  `/api/drive/notifications`), the app watches Drive's changes feed. A notification — trusted only
  for this app's channel and its secret token — triggers the ADR 0003 sweep, debounced 30 s, and
  queues what arrived. The notification carries no payload; the sweep decides what changed.
- **A slow poll**, every 15 minutes (`DRIVE_POLL_INTERVAL_MS`; 0 turns it off), sweeps and queues
  whatever a notification missed, and renews the channel a day before its one-week lifetime ends.
  It runs in the app process, started once from `instrumentation.ts`; no cron, no systemd timer.
- Dashboard load keeps sweeping when stale, as before.

## Consequences

- A document is read minutes after it lands in Drive, so the model's work spreads over the month.
- Channel failure modes from ADR 0003 — expiry, silent channels, lost notifications — cost at most
  one poll interval: the poll sweeps full state and re-watches, independent of any notification.
- The app process now does work while no one is looking: a sweep every 15 minutes (a handful of
  `files.list` calls) and whatever extraction it queues.
- The webhook path is public; its only credential is the channel token, compared in constant time.
  Old channels overlap new ones until stopped; their notifications are turned away.
- The queue is in memory. A restart forgets it; documents still `pending` are queued again by the
  next poll or page view.

## Alternatives considered

- **Poll only.** Simpler and works without a public URL, but files wait up to the poll interval.
  It remains the fallback whenever `DRIVE_WEBHOOK_URL` is unset, as in local development.
- **Changes API page tokens.** Still rejected (ADR 0003): the notification only triggers the full
  sweep, so no delta replay or token persistence beyond the channel itself.
- **Keep page-load sweeps.** Leaves the month-start batch and the duplicate reads.

## Amendment (2026-11-16): two lanes

A document that needs no model was queued behind the model's reads: an eKasa receipt or an ISDOC
invoice waited minutes for a document ahead of it, and the next document's OCR could not start
while the model was busy. Reading is now two lanes, each a BullMQ queue with its own workers:

- **Reading lane** (`extraction`, `READ_CONCURRENCY`, default 3). Downloads the file and does
  everything but the model: text layer, ISDOC and MOL, QR, eKasa lookup, OCR. A document that needs
  nothing more is finished here. A document that needs the model is handed to the model lane with
  the text lines the model is to read: it is not downloaded or OCR'd again.
- **Model lane** (`extraction-model`, global concurrency `EXTRACTOR_CONCURRENCY`, the model's
  slots). Only the model call, the checks and the write. A model outage leaves the document waiting
  here (moved aside, retried when the model is back) while the reading lane goes on; an OCR outage
  leaves the document waiting in the reading lane, as before.

Each lane keeps one job per Drive file, its id the file's, so a document queued twice is read once,
and a file the model lane holds cannot be queued for reading again. A re-read keeps its prior result
until the lane that finishes the document writes a new one; the replacement commit, the re-read
commit and the party checks happen in whichever lane finishes it. A document is recorded on the
queue screen once, when it is finished. The service monitor retries each lane's waiting documents
when the service it waits for comes back.

## Amendment (2026-11-16): the model lane's limit is the server's slots

The model lane's limit was set twice, `-np` on the extractor and `EXTRACTOR_CONCURRENCY` in the
config, and drifted apart: documents queued at the server, where they can time out, or a slot sat
idle. The workers now ask llama.cpp for its slots (`GET /props`, `total_slots`, at the server root)
at start and each time the monitor sees the model come back, and size the model lane to them. The
queue's global limit and the worker's own concurrency are set together, and the size is kept in
Redis for the queue page.

`-np` is now the one setting. `EXTRACTOR_CONCURRENCY` is only the fallback: it, or 1, holds the
lane while the server does not answer or does not say its slots (Ollama answers 404 on `/props`).
A model that comes back is asked again, so a fallback is corrected without restarting a worker.
