# ADR 0004 — SQLite on a single EU VPS

Date: 2026-08-28
Status: Superseded by ADR 0021 (Postgres and Redis, for replicas on k3s).

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

### Amendment, 2026-08-30: extracted data is JSON inside SQLite, not a second database

Once documents became primary (ADR 0013) the field sets diverged — an eKasa receipt carries UID, OKP
and per-item VAT, a Czech receipt has no UID or OKP at all, an invoice and a bus ticket share almost
nothing, and the deferred OCR path (ADR 0008) will emit whatever shape the model returns. That raised
a fair question: whether a document store fits this better than a relational one.

It does not, because the choice is a false one. SQLite has `json_extract`, JSON functions and
generated columns that can be indexed, so it is already both. The useful split is not relational
versus document but **queried versus read back**:

- The workflow fields are thin, stable and queried constantly — company, month, file, extraction
  state, her decision, whether it was exported. Those are columns.
- The extracted payload is wide, type-dependent, and only ever read whole, when she reviews a
  document or the export is built. That is a JSON column.

A field is promoted from the payload to a column when something needs to query, sort or aggregate on
it, which is a migration rather than a redesign.

Her confirmed values are stored as their own payload rather than overwriting the extracted one. That
costs one column and makes it impossible for a later parser improvement to destroy what she typed.

A real document store was rejected: it adds a server process, a dependency and a backup story, and
it forfeits the single-file backup this ADR rests on — for one user and low hundreds of documents a
month.

## Consequences

- No function timeouts. Long operations run to completion without splitting into jobs.
- No queue infrastructure. Documents are processed a few at a time with plain in-process
  concurrency.
- System binaries are available if ever needed (`qpdf`, `libheif`), though the current design
  avoids depending on them for the critical path.
- Backups are copying one file — but this needs an actual plan. Drive remains the legal 10-year
  record, so losing the database costs pairing and extraction work rather than compliance. See PRD
  open question 8.
- Secrets live on the box: the service-account key and the model API key. ~~and the per-company
  statement passwords, encrypted with a key held in the environment~~ — statement passwords are gone
  with ADR 0009's withdrawal, since the app no longer opens statements. The database now holds no
  secret at all, which materially improves the backup story.
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
