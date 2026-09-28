# ADR 0020 — Read documents as they arrive: Drive push, a slow poll, one queue

Date: 2026-09-29
Status: Accepted. Supersedes ADR 0003's "no scheduler" and its dashboard-load channel renewal; the
sweep stays the one ingestion path.

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
