# ADR 0011 — App authentication via Auth.js Google, separate from Drive credentials

Date: 2026-08-28
Status: Accepted

## Context

There is exactly one user. The server will hold her clients' full financial corpus plus the
passwords that decrypt their bank statements, so the login is more consequential than a hobby
app's — but writing authentication is the classic thing not to write.

Because Drive access uses a service account (ADR 0001), there is no need for her to "connect"
Google for data access. App login and Drive access are entirely independent concerns.

## Decision

**Auth.js with the Google provider**, with her email address on an allowlist. Everything else is
rejected.

This uses only basic identity scopes (`openid`, `email`, `profile`), which are non-sensitive.
Consequently this OAuth client needs no verification, shows no warning screen, and has none of the
restricted-scope or 7-day refresh-token problems described in ADR 0001.

The Drive service-account credential and this OAuth client are kept strictly separate: different
credentials, different purposes, no code path where one substitutes for the other.

Tailscale can be layered later if she wants the app unreachable from the public internet.

## Consequences

- Familiar login, no password for her to manage or for us to store.
- An OAuth client must be registered, but with trivial configuration and no review process.
- The allowlist is the entire authorisation model. It must be checked server-side on every
  request, not only at sign-in.
- The app is publicly reachable, so it depends on Auth.js being correctly configured rather than on
  network isolation. Tailscale remains the upgrade path.
- Two Google credentials on the box with different lifecycles and different blast radii. The
  service-account key is the higher-value secret: it guards the whole corpus.

## Alternatives considered

- **Cloudflare Tunnel + Access in front of the VPS.** The recommendation: zero authentication code
  in the app, and the box never exposes a port to the internet. Deferred in favour of a
  self-contained app with no third-party dependency in the request path.
- **Single hashed password in the environment plus a signed cookie.** Roughly twenty lines and no
  dependency, but it is authentication code we would own.
- **Tailscale only.** Strong isolation, but requires a client on every device she uses and offers
  no browser-native sign-in.
