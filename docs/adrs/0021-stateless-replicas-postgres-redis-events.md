# ADR 0021 — Stateless replicas: Postgres, Redis queues, and events pushed to the screens

Date: 2026-09-29
Status: Accepted. Supersedes ADR 0004 (SQLite on a single VPS). Amends ADR 0020: the queue, the
poll and the notification debounce move from process memory to Redis.

## Context

Production moves to its own namespace on a k3s cluster, with **at least two web replicas**. Several
things assumed exactly one process:

- **SQLite** (ADR 0004) is a file on one machine; replicas on different nodes cannot share it.
- **The extraction queue lived in memory** (ADR 0020). Two replicas meant two queues reading the
  same invoices and twice the requests to a model server with one slot.
- **The Drive poll and the notification debounce ran in every process**, and every replica would
  register its own Drive channel.
- **The queue page read that process's memory**, so each replica showed a different half.
- **Screens polled.** The month screen re-rendered every 1.5 s while documents were pending, and
  gave up after a minute — shorter than one invoice with the model on CPU — so a document read
  after that stayed "Spracúva sa…" until a manual refresh.

## Decision

**Postgres for data, Redis for everything replicas share besides data, and every process
stateless.**

- **Postgres** (`DATABASE_URL`). The schema is the same, in `pg-core`; every store function is
  `async`. Timestamps stay ISO text, as before, so comparisons and exports did not change.
  Each replica migrates on start under an advisory lock, so migrations run once however many start.
- **Roles** (`HUGO_ROLE`): `web` serves pages, server actions and the event stream, and only
  *queues* work; `worker` reads documents, sweeps Drive on schedule and checks the model and OCR;
  `all` is both in one process — `npm run dev` and e2e, where the fake Drive lives in one process's
  memory. One image, the command picks the role.
- **BullMQ on Redis** (`REDIS_URL`) replaces the in-memory queue:
  - one job per file, its id the file's, so a file queued by several replicas is one job;
  - receipts before documents (priority), as ADR 0020 had it;
  - `EXTRACTOR_CONCURRENCY` is a **global** limit across all workers, so a second worker adds
    resilience, not a second request to a one-slot model;
  - a document whose model or OCR is down becomes a **delayed** job, retried in a minute or at
    once when the worker sees the service come back. No more re-queuing on every page render;
  - a worker that dies mid-document gives the job back when its lock lapses.
- **Sweeps** take a Postgres advisory lock, so two at once cannot both record the same discovery.
  The 15-minute poll is a BullMQ job scheduler (once per interval for the whole cluster); a Drive
  notification, on whichever replica Google reached, queues one sweep 30 s later, deduplicated.
- **Events.** Whoever causes something publishes it on a Redis channel: `document-read`,
  `files-changed` (after a sweep, with the months affected), `queue-changed`, `services-changed`.
  Every web replica subscribes once and streams them to its browsers as **server-sent events**
  (`/api/events`). A tab keeps one connection, shared by the app bar, the queue page and the month
  screen. The month screen re-renders when one of *its* documents is read or *its* files change,
  and not otherwise; new files from Drive now appear without a reload. These events drive screens.
  The audit trail stays the events table (ADR 0012).
- **Reconnects.** Events sent while a tab was disconnected are lost, so each connection starts
  with the whole queue snapshot, and the screen compares it with what it shows.
- **The worker checks the model and OCR** every ten seconds and keeps the result in Redis with a
  heartbeat. Web replicas cannot, and need not, reach the sidecars. No heartbeat means no worker,
  and the screens say so instead of looking stuck.
- **Health**: `/api/health` (database and Redis) for the web replicas, `/healthz` on
  `WORKER_HEALTH_PORT` for workers. A worker finishes the documents it is reading on SIGTERM.

## Consequences

- Two more services to run. `docker-compose.yml` runs the whole thing: Postgres, Redis, web ×2, a
  worker, the model and OCR sidecars.
- Unit tests run on PGlite (Postgres in the test process), without Docker. The BullMQ tests need a
  Redis (`npm run test:redis`); e2e needs the compose Postgres and Redis and uses its own database
  and key prefix.
- A lost Redis loses what was queued, not data: pending documents are queued again by the next
  sweep or page view. It runs with append-only persistence and `noeviction` all the same, since an
  evicted key is a lost job.
- SSE needs a proxy that does not buffer or compress `text/event-stream`. The route sends
  `Cache-Control: no-transform` and `X-Accel-Buffering: no`, and a comment every 20 s so idle
  connections survive.
- Existing SQLite data is copied with `npm run db:import-sqlite -- ./dev.db`, ids kept.
- **Async everywhere has a trap:** a store call left un-awaited compiles and races, and
  `if (getX())` is always true. `npm run lint:async` (typed ESLint: floating and misused promises)
  guards it; during the migration it found four such writes in the Omega export and two in
  closing and reopening a month.

## Alternatives considered

- **SQLite on a shared volume.** Works for replicas on one node only, and ReadWriteMany volumes
  with SQLite's locking are how databases get corrupted.
- **WebSockets.** Next's route handlers cannot accept them without a custom server, and the
  browser has nothing to send back. SSE is one HTTP response and reconnects by itself.
- **Postgres LISTEN/NOTIFY instead of Redis.** Covers events but not the queue. A queue in
  Postgres (`SKIP LOCKED`) is possible, but BullMQ already has priorities, a global concurrency
  limit, delays, deduplication and schedulers.
- **Keep polling, but cheaper.** The fix for the stuck screen needed the queue's state anyway;
  once it is shared, pushing it costs less than asking for it.
