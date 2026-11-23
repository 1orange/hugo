# 11 — The queue screen, activity log and live updates show only one's own companies

Type: AFK
Status: ready-for-agent

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

After issue 10, company screens are restricted, but three office-wide views still show every company's
work. Apply the same visibility guard to them:

- **Queue screen**: in-progress, waiting (including issue 02's per-month section and estimate) and
  recently finished documents only for visible companies. Lane concurrency and the Drive panel stay
  global.
- **Activity log** (the global view): only events of visible companies. Office-wide events, such as
  settings changes or the client sheet import, stay visible to all.
- **Live events (SSE)**: an event naming a company is sent to a browser only if that session can see
  the company. The reconnect snapshot is filtered the same way.

## Acceptance criteria

- [ ] Two users with different visible companies: each one's queue screen lists only their companies' documents (integration test on the snapshot, UI test on the page).
- [ ] The issue 02 estimate counts only the viewer's waiting documents.
- [ ] The activity log shows only visible companies' events plus office-wide ones.
- [ ] An event for an invisible company is not delivered on that user's event stream. The reconnect snapshot is filtered (test on the stream filter).

## Blocked by

- 10 — Each person sees only the companies shared with them in Drive
