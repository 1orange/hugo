# 04 — Turn on Drive push in production

Type: HITL
Status: ready-for-human

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

Make sure production is told about new uploads within seconds, not at the next poll. The developer
owns the production configuration (Infisical environment *dev*, path `/apps/hugo`, synced to the
cluster). Agents do not edit it.

1. The developer checks that `DRIVE_WEBHOOK_URL` is set in production to the public URL +
   `/api/drive/notifications`, and sets it if not.
2. The developer checks that the notification route is reachable from the internet through the
   ingress: a request without a channel token is turned away, not blocked by the proxy.
3. After the next poll registers the channel, the issue 03 panel shows *Push zapnutý* with an expiry
   date about a week ahead.
4. Upload a test file into a client's current month folder. Within about a minute, the panel shows a
   new accepted notification and the file appears on the month screen and in the queue.
5. Remove the test file.

## Acceptance criteria

- [ ] `DRIVE_WEBHOOK_URL` is set in production.
- [ ] The issue 03 panel shows push mode with a channel expiry.
- [ ] A test upload is discovered within about a minute (accepted notification time and discovery recorded).
- [ ] Findings (worked first time, or what had to change) noted in this issue.

## Blocked by

- 03 — The queue screen shows Drive push status
