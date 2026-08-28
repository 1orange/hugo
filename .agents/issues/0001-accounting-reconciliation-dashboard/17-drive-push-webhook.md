# 17 — Drive push webhook

Type: AFK
User stories: 11 (latency aspect)

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

A latency optimisation, deliberately last, and deliberately without its own ingestion path.

Per ADR 0003 the webhook does **not** call `changes.list` and does not maintain a page token. It
simply says "something changed" and triggers the existing sweep, debounced around 30 seconds so a
client dropping twelve files causes one sweep rather than twelve. The sweep remains the single
source of truth and compares full Drive state, so a lost notification costs latency and never
correctness.

Channel renewal happens on dashboard load, not on a timer. This matters: a changes channel caps at
**one week**, defaults to **one hour**, and cannot be renewed — a new channel must be created with
a new id. If the only code path creating a channel lived in the webhook handler, a quiet week would
expire the channel, no notification would ever arrive again, and the app would go deaf silently.
Renewing on load makes that impossible.

Delivery is at-least-once at best. Google retries only on `500/502/503/504`; every other response
is treated as a message failure with no retry. The endpoint must therefore be idempotent, respond
quickly with a success status, and never do the sweep work inline on the request.

## Acceptance criteria

- [ ] A watch channel is created and its id, resource id and expiry are persisted
- [ ] The webhook endpoint responds with a success status quickly and does not perform the sweep inline
- [ ] Notifications are debounced — twelve rapid notifications cause one sweep
- [ ] The webhook triggers the same sweep function as Refresh, with no parallel ingestion code path
- [ ] No `changes.list` call and no page token anywhere in the implementation
- [ ] Dashboard load renews the channel when it expires within a day, using a fresh unique id
- [ ] Overlapping channels during renewal do not cause duplicate processing
- [ ] The initial `sync` notification is recognised and ignored rather than treated as a change
- [ ] An expired or silently dead channel is invisible in behaviour — the next dashboard load catches everything
- [ ] The endpoint verifies the request originates from the expected channel before acting
- [ ] Integration test: simulate a notification and assert exactly one debounced sweep

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
