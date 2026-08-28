# ADR 0001 — Google Drive access via a service account

Date: 2026-08-28
Status: Accepted

## Context

The app must read every client's documents and, for late arrivals, move files between month
folders. Two access models were available.

The initial assumption was that clients shared folders *with her*, which would have forced OAuth
as her user. That assumption was wrong: **she owns the folders and shares them with her clients.**
Clients upload into folders she owns.

That distinction matters because of Google's scope classification. The full `drive` scope needed
for writes is a *restricted* scope. Under OAuth with an External audience, that means either an
unverified app (permanent "Google hasn't verified this app" warning, 100-user cap) or verification
including an annual paid CASA Tier 2 security assessment. Testing status is not an option at all:
it caps refresh tokens at 7 days.

Because she owns the folders, none of that applies.

## Decision

Access Drive with a **service account**. Every company folder sits under one parent folder that is
shared once with the service-account address as Editor. Credentials are a key file on the server.

No OAuth flow for Drive, no consent screen, no refresh tokens, no verification, no CASA, no
100-user cap, no token expiry.

Files uploaded by clients are owned by those clients. The service account's write access comes
from permission inheritance on the containing folder, which is expected to permit moves. This is
verified per file at runtime by checking `capabilities.canMoveItemWithinDrive` before attempting a
mutation, rather than attempting and handling failure.

## Consequences

- Setup is one folder share instead of an OAuth integration.
- Requires that all company folders can live under a single parent. Confirmation pending — see
  PRD open question 5.
- There is no "sign in with Google to connect Drive" step, so app authentication is a wholly
  separate concern. See ADR 0011.
- The service-account key is a high-value secret on the box. It is the sole credential guarding
  the entire client corpus.
- Client-owned files mean a client deleting their own file removes it from her folder. The app
  detects this via the sweep and records a `FileDeleted` event rather than losing the row.

## Alternatives considered

- **OAuth as her, External + Published-but-unverified.** Works, and was the plan before the
  ownership fact emerged. Costs a scary consent screen and a refresh token to keep alive, for no
  benefit now.
- **Internal Workspace app.** Skips verification entirely, but requires she is on Google Workspace
  with her own domain. Unnecessary given the service-account route.
- **Google Drive for Desktop, treating Drive as a local filesystem.** Removes the API entirely but
  ties the app to her laptop and inherits sync-lag and conflict semantics.
