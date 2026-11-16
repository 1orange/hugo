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

Confirmed against the live Drive on 2026-08-30, once real credentials existed: **78 of 115 folder
names arrive as NFD**, along with 129 document names. Two thirds of her folders. Without this
normalisation almost every canonical folder in the account would have been classified as a repair
candidate proposing a visually identical rename, which is the failure this amendment exists to
prevent — and at that scale she would have been offered dozens of them.

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

## Amendment, 2026-11-11 — the office's names, and conformance above the month (PRD 0004)

**Default names.** The office's agreed structure renames two slots: `04 Bločky_hotovosť` becomes
`04 Platby hotovosťou` and `05 Bločky_firemná karta` becomes `05 Platby kartou`. The default list
changes; a stored list is migrated only if it still equals the old default, and the impact preview
remains the way to check a change. The old and new names are far beyond the edit distance of the
near-miss rule, so a folder still carrying an old name is *unrecognised*, not a repair candidate —
deliberately: a rename across a convention change is a decision, not a typo.

**Conformance beyond the month folder.** Classification stays as decided here. The structure check
of PRD 0004 extends the same "visible rather than silently dropped" principle upward: a company folder
without the `Konto ` prefix, a missing or duplicate month of the current year, a past-year `YYYY_MM`
folder left beside the current year, an unknown folder at company level, and files lying directly in
a company or archive folder are all reported. Past-year archive folders (`YYYY`) are accepted and not
inspected. Only near-miss subfolders get a rename proposal; everything else is for a person to fix in
Drive. Deviations are recomputed on every sweep, so a fix in Drive clears them.

**Display name.** The `Konto ` prefix is part of the Drive name, not the company's name. Hugo strips
it for display and for the register search of ADR 0018; the stored Drive name is unchanged.

## Amendment, 2026-11-12 — the office's structure: read by depth, types by code

The office described its drive ("Štruktúra disku Doklady klientov – podklad pre dashboard",
`.agents/ctx/`): disk → accountant → client → month → document type, to be read by **position and
folder ID, not by names**. Hugo follows it:

- **Level 1:** every folder at the root of the drive is an accountant, or the archive (its name says
  "archív"); the group's name is the part before " – ". A root folder that holds month folders itself
  is still read as a company, as in the flat layouts before 2026-11-11.
- **Level 2:** every folder in a group folder is a client, whatever its name (now `Doklady <client>`;
  the display name strips `Doklady ` and the older `Konto `). A client in the archive gets no new
  months and is not chased.
- **Level 3:** a month is a folder whose name **starts** with `YYYY_MM` (`2026_10`, `2027_01 január`);
  other folders there (year archives) are ignored.
- **Level 4, from 2027_01:** a folder is its **code** `01`–`08`, whatever follows it. The canonical
  list is the office's eight types: `01 Vystavené faktúry`, `02 Prijaté faktúry`, `03 Bankové výpisy`,
  `04 Bločky`, `05 Cestovné príkazy`, `06 Ostatné dokumenty`, `07 Mzdy`, `08 DPH`. No repairs are
  proposed in these months; a folder without a code is unrecognised.
- **Level 4, before 2027_01:** by **name**, because the old numbers meant other things:

| Older name | Type |
|---|---|
| `04 Platby hotovosťou`, `05 Platby kartou`, `05 Platby firemnou kartou`, `04/05 Bločky_…` variants | `04 Bločky` |
| `06 Iné doklady`, `05 Iné doklady` | `06 Ostatné dokumenty` |
| `06 Cestovné príkazy` | `05 Cestovné príkazy` |
| `06 Mzdy` | `07 Mzdy` |
| `07 DPH` | `08 DPH` |

  An older month is not expected to hold `05` or `08` (it never had them). A near-miss of a name is
  still a repair candidate, renamed to the type's current name.

Cash and card receipts are one type, `04 Bločky`; Hugo no longer tells them apart by folder (nothing
downstream used the difference). Processed types: `01`, `02`, `04`, `06`; `03` is presence-only;
`05`, `07`, `08` are not read. Movable by default: `02`, `04`, `06`. Stored slot values are migrated
(0008), and a settings list still on an earlier default moves to the eight types.
