# ADR 0007 — Canonical folder names, with a one-time rename repair

Date: 2026-08-28
Status: Accepted

## Context

Each month folder contains seven numbered subfolders. The names in real data are not reliable:
`2026_05` contains `04 Bločky_hotorvosť` — a typo — while every other month has
`04 Bločky_hotovosť`.

The obvious defence is to match on the two-digit prefix and ignore the rest of the name, which
makes the typo harmless without touching anything. That works, but it means a permanent fuzzy
matching chain in the codebase, and it accepts that folder names are unreliable forever.

The decision changed once the app took over creating the structure. If the app scaffolds every
month, names are canonical by construction going forward, and only history is dirty.

## Decision

Match folders on their **exact canonical name**, taken from a configurable list in global
settings. No prefix matching, no fuzzy fallback, no alias table in the code.

The sweep flags any folder in a month that is not in the canonical list as **unrecognised**. She
repairs it with one click, which renames it to the canonical name using the same
propose/confirm/record/undo flow as file moves (see ADR 0006).

The two-digit prefix is retained in the canonical names for ordering and display, but it is not
used as a matching key.

This is safe because **Drive renames preserve file IDs** — client links, shortcuts and permissions
all survive a folder rename. Renaming is materially less dangerous than moving.

## Consequences

- The codebase has one matching rule instead of a fallback chain.
- Historical typos are fixed once, in data, rather than worked around forever, in code.
- An unrecognised folder is visible rather than silently dropped from the month view, which was
  the failure mode of naive exact matching.
- The canonical list living in settings means changing her filing convention is a settings edit.
  It also means the list is data that must be correct — a wrong entry makes every existing folder
  look unrecognised.
- Per-company template overrides are supported, so a client with no employees does not carry an
  empty `07 Mzdy` forever.

## Alternatives considered

- **Permanent fallback chain: exact name, then two-digit prefix, then fuzzy.** Never touches her
  folders, but keeps fuzzy logic in the codebase indefinitely and normalises unreliable names.
- **Canonical name plus a per-folder alias list she maintains.** Avoids the rename, but grows a
  configuration surface that only ever accumulates.
- **Exact match only, unrecognised folders shown as "unmapped" for her to fix in Drive by hand.**
  Honest, but pushes manual work back onto the person the app exists to unburden.
