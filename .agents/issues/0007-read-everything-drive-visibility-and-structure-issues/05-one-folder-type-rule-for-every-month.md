# 05 — One folder-type rule for every month

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

Folder types are read by code (01–08) only from `2027_01`, and by name before. The office asked for
the code rule now. Old numbering means something else (an old `05` is card receipts, a new one is
travel orders), so a plain code rule would misfile historic folders. Use **one rule in every month**:

1. exact canonical name;
2. accepted older name (the existing table), which keeps its old meaning;
3. the two-digit code (`04`, `05 Iné`, `04 bločky a pokladňa`);
4. near-miss repair of a canonical or accepted name;
5. unknown.

- Add two accepted names seen on the live drive: `Bločky` → `04 Bločky`, and `08 Cestovné náhrady` →
  `05 Cestovné príkazy`.
- Months before 2027 still don't *expect* the `05 Cestovné príkazy` and `08 DPH` slots: the office's
  scripts never added them there.
- Replace the settings text about January 2027 with a description of the single rule.
- Amend ADR 0007 (2026-11-23).

## Acceptance criteria

- [x] Every accepted older name resolves to its old slot in a 2025 and a 2026 month. In particular `05 Platby kartou` → `04 Bločky`, `06 Iné doklady` → `06 Ostatné dokumenty`, `07 DPH` → `08 DPH`.
- [x] A coded name that is neither canonical nor accepted (`04`, `05 Iné`) resolves by its code in a 2026 month.
- [x] `Bločky` and `08 Cestovné náhrady` resolve as specified.
- [x] Behaviour from `2027_01` is unchanged (the existing tests pass).
- [x] Expected slots for months before 2027 are unchanged.
- [x] A sweep over a month with a coded folder discovers its files and queues them. Previously they were unknown (sweep integration test).
- [x] Settings text updated, ADR 0007 amended.

## Blocked by

None - can start immediately
