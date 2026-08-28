# ADR 0003 — Sweep-based Drive sync, webhook as trigger, no scheduler

Date: 2026-08-28
Status: Accepted

## Context

The app must notice new uploads. Options were polling on a schedule, Drive push notifications, or
the Changes API with a stored page token.

Drive push has properties that make it unsuitable as a sole ingestion path:

- A changes channel expires. Maximum lifetime is **one week**; the default is **one hour**. There
  is no renewal — a new channel must be created with a new id, with an unavoidable overlap window.
- Notifications carry no payload. Receiving one only tells you to go ask Drive what changed.
- Delivery is at-least-once **at best**. Google retries only on `500/502/503/504`; every other
  response is treated as a message failure with no retry. A bad deploy or an expired certificate
  loses those notifications permanently.
- There are current reports of channels going silent after the initial sync ping.

Critically, if the only code path that creates a channel lives inside the webhook handler, then a
quiet week expires the channel, no notification ever arrives again, and the app goes deaf
**silently**. Webhook-only ingestion is self-terminating.

At her volume — 5–15 companies, low hundreds of documents a month — a full sweep is a handful of
paginated `files.list` calls.

## Decision

**One ingestion path: the sweep.** A single paginated
`files.list(q="trashed=false", fields="files(id,name,parents,createdTime,mimeType)")` returns the
entire corpus visible to the service account, and the tree is rebuilt in memory from `parents`.
The sweep diffs full Drive state against the database and emits domain events.

The sweep is invoked by exactly two triggers:

1. The **webhook**, debounced roughly 30 seconds, so a client dropping twelve files causes one
   sweep.
2. **Dashboard load**, when `lastSweepAt` is stale. The same path re-watches the Drive channel
   when it expires within a day.

**No scheduler.** No cron, no systemd timer. State only has to be correct when she is looking at
it, and she works the books monthly.

## Consequences

- Push is a pure latency optimisation. If a channel dies, the next dashboard load renews it and the
  sweep catches every change since, because it compares full state rather than replaying a delta.
- No page tokens, no delta replay, no overlap deduplication, no reconciliation backstop as a
  separate mechanism.
- Nothing happens in the background while she is away. Late-arrival proposals appear when she
  opens the dashboard rather than waiting for her each morning — irrelevant on a monthly cadence.
- Extraction runs on webhook-triggered discovery or on demand.
- The sweep must be idempotent: a repeated sweep over unchanged input emits no events. This is a
  tested property.
- The VPS runs Caddy, the Next app, and a SQLite file. Nothing else.

## Alternatives considered

- **Nightly cron plus webhook.** Correct, but the cron existed only to renew the channel and act
  as a backstop — both of which dashboard load does for free.
- **Changes API with page tokens.** Processes true deltas, but adds token persistence, gap
  handling and a backstop sweep anyway, to save a few API calls at this volume.
- **Sweep on every page load unconditionally.** Simple, but re-reads Drive on every navigation.
- **Webhook only.** Rejected as self-terminating, per the expiry analysis above.
