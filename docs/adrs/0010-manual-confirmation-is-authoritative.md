# ADR 0010 — Her confirmation is authoritative and gates the export

Date: 2026-08-28
Status: Accepted

## Context

One of the original requirements was to mark which files had been processed. Once pairing existed,
that status became largely derivable: extracted → paired → exported. A manual checkbox on top of
derived status is a second source of truth, and the two will disagree.

The argument for removing it was fewer states and less UI. The argument for keeping it is that she
wants to trust her own marks over the system's inference, and she is the only user.

Separately, the corpus contains a booking hazard. `2026_01/02 Prijaté faktúry` holds
`Predfaktúra_8825079596.pdf`, `Predfaktúra_8825079785.pdf`, `predfaktúra_relia.pdf` and
`9600006390_proforma_faktura.pdf`. Proformas are not accounting documents. If a proforma and the
real invoice that follows it are both extracted and paired, the expense is **double-booked**.

The obvious fix was a separate "ignore" flag with a reason. That is a second concept to build,
learn and keep consistent with the first.

## Decision

**Her checkbox is authoritative**, and it does two jobs:

1. It is the progress marker. "What's left" counts unticked payments, because that is her mental
   model of remaining work.
2. It is the **export gate**. Nothing reaches the Omega export unless she ticked it.

Derived status is still computed and shown, but only as a quiet hint alongside her tick. The app
never claims work is finished that she did not approve.

No separate ignore flag, no reason codes. A proforma or a duplicate is simply never ticked, so it
cannot be exported and cannot double-book.

## Consequences

- One flag covers work tracking, export approval and exclusion of non-accounting documents. Three
  requirements, one concept.
- Two sources of truth exist by design. The resolution rule is explicit: hers wins, the derived
  status is advisory.
- Export becomes trivially safe to run — it can only ever contain approved items.
- She carries the responsibility for spotting a proforma. The app does not attempt to classify
  document types, consistent with not encoding Slovak tax rules (ADR 0002).
- Auto-detecting proformas from extracted text and pre-setting the flag remains available as a
  later convenience, but it must never bypass her tick.

## Alternatives considered

- **Derived status plus a manual "Ignore" toggle with a reason.** Cleaner conceptually and gives a
  single source of truth, but adds a concept and overrides her judgment with inference.
- **A separate "approve for export" step distinct from ticking off work.** Arguably two different
  decisions, but in a single-user workflow it is two clicks for one intent.
- **Export everything paired, with review of the generated file.** Moves the check to the least
  reviewable artefact — an XML file — and makes double-booking the easy path.
