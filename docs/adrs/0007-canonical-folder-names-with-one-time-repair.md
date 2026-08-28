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

### Amendment, 2026-08-28: how a repair target is chosen

Implementing slice 03 exposed a gap. "Flag anything not canonical for repair" says nothing about
*which* canonical name to propose, and the first implementation picked it by two-digit prefix. That
reintroduced prefix matching through the back door, and worse: a folder the client created on
purpose, such as `04 Pokladňa`, was offered as a rename to `04 Bločky_hotovosť`. Because repairs
become real Drive renames on confirmation, a wrong proposal she accepts destroys her intent.

A repair target is therefore proposed only when the observed name is a **near-miss** of exactly one
canonical name. Comparison folds away case, diacritics and the space/underscore distinction — none
of which are ever meaningful here, and clients do type from keyboards lacking Slovak diacritics —
then requires an edit distance of at most 2 on the folded text. Ties propose nothing.

Anything else stays unrecognised and is surfaced for her to handle, which is the honest outcome:
`04 Bločky_hotorvosť` is a typo worth one click, `04 Pokladňa` is a decision only she can make.

### Amendment, 2026-08-28: exact matching requires Unicode normalisation

"Match folders on their exact canonical name" is not implementable as literal string equality. Every
diacritic-bearing folder name in the real sample is **NFD**; the canonical list in code is NFC. Six
of the seven canonical folders therefore matched nothing and were classified as repair candidates
proposing a rename to a name that is *visually identical*. The no-op guard did not catch it, because
the byte sequences genuinely differ, so she would have confirmed a Drive rename that did nothing.

Both sides are now normalised to NFC: Drive names as they enter the sweep, and the canonical list at
comparison time. This matters more once the list is editable rather than a constant — she will paste
names copied out of Drive, which on macOS arrive as NFD.

Normalisation is not the same as the folded comparison used to pick a repair target. Folding strips
diacritics entirely and is only ever used to *suggest*; normalisation makes two spellings of the same
name equal, which is a correctness requirement for matching.

This is bounded fuzziness in service of a *suggestion*, not the fallback chain this ADR rejected.
Slot assignment remains exact-name-only: a repair candidate keeps its observed name until she
confirms the rename, so no document is ever filed into a canonical slot on the strength of a guess.

### Amendment, 2026-08-28: the editable list needs an impact preview

Slice 14a made the list real settings data rather than a constant, which turns the risk this ADR
noted in passing — "a wrong entry makes every existing folder look unrecognised" — into something
she can trigger with a typo in a textarea.

Saving therefore shows an impact preview computed by classifying every stored folder twice, under
the current list and under the proposed one, using the same `classifyFolder` the sweep uses. The
preview cannot drift from real behaviour because it *is* real behaviour, run on the proposed
settings.

It reports both directions. Folders that would stop being recognised are the warning, with removals
called out separately from renames because a removal drops a slot she is actively filing into.
Folders that would *become* recognised are the confirmation: adding a name a client already uses is
the intended way to adopt a real folder such as `04 Pokladňa`, and a preview that only counted
breakage would report "no impact" for the one change she meant to make.

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
