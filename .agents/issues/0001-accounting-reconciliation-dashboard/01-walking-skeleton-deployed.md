# 01 — Walking skeleton, deployed

Type: AFK
User stories: 1

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The thinnest possible complete path from a browser to the database and back, running on the real
server. Nothing about accounting yet — this slice exists so that every later slice has somewhere
to land and a deployment that already works.

A Next.js App Router application with TypeScript, Tailwind and shadcn/ui. Authentication through
Auth.js with the Google provider, authorising against an allowlist of email addresses held in
configuration. The allowlist must be enforced server-side on every request, not only at the
sign-in callback.

State in SQLite through `better-sqlite3` and Drizzle, with a migration mechanism and one initial
migration. Synchronous database access is intended, per ADR 0004.

Deployed to the EU VPS: Caddy terminating TLS, the app running as a systemd service. No scheduler
is configured, and none should be added — see ADR 0003.

The visible surface is a single page listing companies, which at this point is empty with an
explanatory empty state.

## Acceptance criteria

- [ ] Signing in with an allowlisted Google account reaches the company list page
- [ ] Signing in with a non-allowlisted Google account is refused with a clear message
- [ ] Requesting an authenticated route without a session is refused server-side, not merely hidden in the UI
- [ ] The database file is created and migrated on first boot
- [ ] Drizzle migrations run idempotently — a second boot changes nothing
- [ ] The application is reachable over HTTPS on the VPS via Caddy and survives a host reboot
- [ ] Secrets are read from the environment; no credential appears in the repository or in the database
- [ ] No cron job or systemd timer exists
- [ ] `node --test` runs and passes in CI or locally with zero test-framework dependencies
- [ ] E2E covers both the refused and the accepted sign-in paths

## Blocked by

None - can start immediately
