# 14 — *Prevziať z profilu*

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

When the client's own party on a document disagrees with the client's profile, the finding already
shows the profile's value ("IČO nezodpovedá profilu klienta — v profile: …"), but the accountant has
to copy it by hand. Add a one-click fix next to *Prevziať z registra*.

- **Offer rule (pure, next to `offersRegisterTakeover`).** `offersProfileTakeover(check)`: the party's
  verdict holds a `profile-name`, `profile-ico`, `profile-dic` or `profile-icdph` mismatch with an
  expected value.
- **Service** `takePartyFromProfile(company, month, document, side)`. Refused unless:
  - the stored verdict for the document's current values offers it;
  - the document is not exported;
  - the month is editable.
  It writes the profile's legal name, IČO, DIČ and IČ DPH (only those the profile has) as overrides
  with provenance `profile`. Unlike the register takeover, it writes the IČO too. It re-runs the
  party check and records an activity event, like the register takeover.
- **UI.** A *Prevziať z profilu* button beside *Prevziať z registra* on the party's fieldset, in the
  same style. Its tooltip lists what will be written. When both apply, both show.

## Acceptance criteria

- [x] Offer rule unit tests: each profile code offers it; register-only findings don't; a finding without an expected value doesn't.
- [x] The service writes the profile's values with provenance `profile`, IČO included. It refuses on an exported document, a closed month, and a stale verdict (integration tests, mirroring the register takeover's).
- [x] After taking, the party's verdict no longer reports the profile mismatch.
- [ ] The button appears only when offered, beside *Prevziať z registra* when both apply. Clicking it updates the fields (UI / e2e test). Unmet in this run: the offer logic and the "both show" case are covered by `tests/ui/fields-panel-profile.spec.ts`, which is written but not run (Playwright was not run, per the brief).

## Blocked by

None - can start immediately
