# ADR 0004 — SQLite on a single EU VPS

Date: 2026-08-28
Status: Accepted

## Context

One user, 5–15 companies, low hundreds of documents a month. The workload includes decrypting
password-protected PDFs, extracting text, calling a model, and generating export files.

The default reflex would be Next.js on Vercel with a hosted Postgres. That brings function
timeouts, cold starts, connection pooling, and no local filesystem — none of which buy anything
for a single user.

The data is Slovak companies' financial records held by an accountant with professional
confidentiality duties, so EU hosting is a requirement rather than a preference.

## Decision

A single small **EU VPS**. Caddy terminates TLS, the Next.js app runs as a systemd service, state
lives in **SQLite** accessed through `better-sqlite3` with Drizzle.

Synchronous database access is acceptable and preferable at this scale.

## Consequences

- No function timeouts. Long operations run to completion without splitting into jobs.
- No queue infrastructure. Documents are processed a few at a time with plain in-process
  concurrency.
- System binaries are available if ever needed (`qpdf`, `libheif`), though the current design
  avoids depending on them for the critical path.
- Backups are copying one file — but this needs an actual plan. Drive remains the legal 10-year
  record, so losing the database costs pairing and extraction work rather than compliance. See PRD
  open question 8.
- Secrets live on the box: the service-account key, the model API key, and the per-company
  statement passwords. The passwords are encrypted with a key held in the environment and never in
  the database, so a leaked backup does not leak passwords. Against a full host compromise this is
  theatre; against the likely leak it is real.
- Ops is owned rather than outsourced: TLS renewal is Caddy's job, but patching and uptime are not
  someone else's problem.
- Deployment is a build and a service restart, not a git push.

## Alternatives considered

- **Vercel + Neon Postgres.** Zero ops and free at this volume. Rejected because of function
  timeouts and the absence of a persistent filesystem, for a workload that does document
  processing and has exactly one user.
- **Vercel + Supabase.** Same objection, plus auth and storage features that are not needed.
- **Turso / libSQL.** SQLite semantics with a hosted backend. Adds a dependency to solve a problem
  (serverless-compatible SQLite) that does not exist once the app is not serverless.
- **Local-only on her laptop.** Strongest privacy story and no hosting, but no access from
  anywhere else and every dependency becomes her problem to install.
