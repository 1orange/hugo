# 05 — A shorter answer from the model

Type: AFK
Status: done (not adopted)

## What to build

On the production node the model writes at 7.8 tokens/s, and its answer is the larger part of the
wait: 332 tokens median, 45 s. Much of those tokens is the JSON's structure — property names such
as `taxableSupplyDate` or `baseLiteral` repeated per VAT row, and whitespace — not values.

Make the answer shorter without changing what is extracted:

- short property names in the JSON schema sent to the model, mapped back to the current payload in
  the extractor adapter;
- no whitespace between tokens in the grammar;
- no field the app never reads.

Score it with the benchmark against the current schema on the same fixtures.

## Acceptance criteria

- [ ] The extractor adapter maps the short answer to exactly the payload it produces today (unit tests on recorded answers).
- [ ] Benchmark: median answer tokens and median time recorded before and after, in ADR 0017.
- [ ] Benchmark accuracy is unchanged (exact-or-empty-flagged not lower, wrong-but-plausible not higher). Otherwise the change is not kept and the result is recorded.

## Blocked by

None - can start immediately

## Outcome (2026-11-16): not adopted

Three alternatives were benchmarked against the current answer on the same fixtures and server:
short property names under the JSON schema; short names under a whitespace-limited grammar; and
the current names under that grammar. The short names raised the answer to 371 tokens (328 now);
the grammars cut it by 3% and 13%. All three lowered exact-or-empty-flagged (95.1% now; 69.7% to
78.9%). None is kept, so the acceptance
criteria are not met as written: the mapping, the grammar and the schema are unchanged. The
numbers and the reasons are in ADR 0017 (amendment, 2026-11-16). Every answer field is read by the
app, so none could be dropped.
