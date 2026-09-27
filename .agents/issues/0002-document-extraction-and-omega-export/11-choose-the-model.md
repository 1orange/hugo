# 11 — Choose the model

Type: HITL
Status: needs-human
User stories: 45

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The decision ADR 0017 leaves to measurement: which model, what size, and whether thinking earns its
cost. Human in the loop because it is a judgement over the numbers, and possibly a trade-off the bar
does not settle on its own.

Run the slice 10 harness on the Mac, in Docker, CPU-only, over a small set of candidates — from about
0.5B upwards to the largest that plausibly fits the deployment node's 16 GB — each with thinking off
and on. Record a results table: per-field accuracy, check-state distribution, wrong-but-plausible
rate, median and worst time per document, memory use.

A model is adopted only if it clears the bar: no wrong amount that passes the arithmetic check, at
least 90% of other fields right or empty-and-flagged, at most 5% wrong-but-plausible, median 60
seconds or less. If none does, record the closest and the decision taken — a larger model, a
vision-language candidate, or leaving the model path off until one clears it.

## Acceptance criteria

- [ ] At least three model sizes are run, each with thinking off and on
- [ ] Results are recorded as an amendment to ADR 0017, with the table and the chosen configuration
- [ ] The chosen model and thinking mode become the default configuration
- [ ] If no candidate clears the bar, the amendment says so and records what happens instead
- [ ] Memory use is recorded, so slice 14 can pick a node

## Blocked by

- 10 — Local model sidecar and checked extraction in the harness
