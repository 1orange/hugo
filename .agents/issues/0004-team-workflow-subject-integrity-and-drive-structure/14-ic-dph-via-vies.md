# 14 — IČ DPH checked with VIES; VAT groups and dissolved subjects

Type: AFK
Status: done
User stories: 32, 33, 53

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Extend directory resolution with the `VatRegister` port (VIES), asked once per subject and cached with
the rest of the subject. Integrity adds: IČ DPH invalid in VIES → mismatch; valid with a different holder
name → mismatch; holder *Group registration* → verified only when the directory records the subject as a
member of that VAT group, otherwise a notice. A subject's VAT-group membership is recorded when known
(from a confirmed document or a manual correction). The directory also records register status and VIES
status, and a document from a subject that is dissolved or no longer VAT-registered shows a finding.
VIES not answering yields `unavailable` for that check only.

## Acceptance criteria

- [ ] An unregistered IČ DPH is a mismatch; a registered one with the matching holder is verified.
- [ ] A registered IČ DPH held by a different name is a mismatch showing the VIES holder.
- [ ] `SK7120001713` (*Group registration*) on a Slovnaft receipt is verified once Slovnaft is recorded as a member, and a notice before.
- [ ] A dissolved or deregistered subject is flagged on new documents.
- [ ] VIES is asked once per subject per refresh period; an outage leaves other checks in force.
- [ ] Unit tests cover the VIES rules; integration tests with a fake VIES cover caching, group membership and outages.

## Blocked by

- 13 — Subject directory, with name and DIČ verified against the registers
