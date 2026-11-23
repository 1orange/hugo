# PRD 0008 — Faster model reading: prompt-lookup decoding, training pairs, and a fine-tuned small model

Status: ready-for-agent
Primary users: the office's accountants (indirectly: documents ready sooner at month start); the developer
Continues: PRD 0007 (`.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`), its
pipeline speed investigation
ADRs: amends ADR 0017 (local model extraction); introduces ADR 0024 (a fine-tuned extraction model,
trained locally on confirmed documents), written when phase 3 reaches its decision.

> The model is the reading pipeline's bottleneck by two orders of magnitude (PRD 0007, Further Notes):
> ~48 s median per document on the CPU-only node, most of it spent writing a ~328-token answer at
> ~7.8 tokens/s. This PRD attacks it in three phases, each gated by the existing benchmark: first a
> decoding change that needs no training (prompt-lookup or draft-model speculative decoding), then
> capturing every confirmed document as a training pair, then fine-tuning a small model on real pairs
> plus synthetic ones, so that a 1–2B model reads as well as today's 4B in a fraction of the time.

---

## Problem Statement

With PRD 0007, documents are read in the background as they arrive, so the model's speed no longer
decides *whether* a document is ready when an accountant opens it — but it still decides *how soon*.
One model slot reads about 75 documents an hour. At month start, when clients upload a month's worth of
invoices at once, the queue takes hours to drain; a rebuilt database takes about a day; and a
pipeline version bump re-reads every open month. Accountants who open a client during that window
see *Spracúva sa…* instead of values.

The cost is structural, not a bug:

- **The answer dominates on the node.** Generating a token on CPU is bound by memory bandwidth: each
  token reads all model weights once. Qwen3 4B at Q4_0 is ~2.3 GB; at ~18 GB/s effective that is the
  ~7.8 tokens/s measured, so a 328-token answer costs ~42 s of the ~48 s.
- **Lower-bit formats do not help on CPU.** Q4_0 is already ~4.5 bits per weight; FP4 formats
  (MXFP4, NVFP4) are ~4.25 bits — the same bytes, so the same speed. FP4 pays off only on GPUs with
  FP4 tensor cores. 3- and 2-bit quantisations cut bytes by a quarter to a half but small models lose
  accuracy quickly at those depths.
- **Smaller general models are not accurate enough.** On the labelled benchmark (M4, CPU): Qwen3-4B
  93–96% exact-or-flagged at ~50 s → ~32 s median; Qwen3-1.7B 88% at 23 s; Qwen3-0.6B 65% at 10 s;
  LFM2.5-1.2B 51% at 12 s. The speed is there; the accuracy is not, without training.
- **A shorter answer cost accuracy** (ADR 0017, 2026-11-16): short field names and a whitespace-free
  grammar cut tokens, but the general model filled short keys carelessly. A model *trained* on the
  compact format would not have that problem.
- **The training data exists but is not kept.** Accountants confirm every document (ADR 0010), so each
  confirmed document is a human-verified label. But Hugo stores only the model's answer and the
  confirmed values, not the text the model read, so no (input, label) pair can be built without
  downloading and re-reading every file.
- **The benchmark is tiny.** 17 labelled documents from one month of one client. It cannot tell a 95%
  model from a 92% one with confidence, let alone validate a fine-tune.

## Solution

Three phases, each ending in a benchmark decision; a phase that does not clear the bar is not deployed.

1. **Faster decoding without training.** Most answer tokens are copied from the document (names,
   IČO, DIČ, IČ DPH, amounts, dates) or are predictable JSON structure. llama.cpp's speculative
   decoding — prompt-lookup (n-gram drafts from the prompt itself) or a small draft model (Qwen3-0.6B
   drafting for the 4B) — proposes several tokens and verifies them in one forward pass, which on a
   bandwidth-bound CPU costs about the same as producing one. Benchmark both on the node; adopt the
   faster one if accuracy is unchanged.
2. **Capture training pairs and grow the benchmark.** Every document the model reads keeps the exact
   text it read, the pipeline version, the model id and the raw answer. When the accountant confirms the
   document, it becomes an (input text, verified fields) pair. A dataset export turns confirmed
   documents into a held-out real benchmark (hundreds of documents across many clients) and a training
   set.
3. **Fine-tune a small model.** Once ~1,000 confirmed pairs exist, fine-tune a 1–2B model (Qwen3-1.7B
   first, 0.6B as a stretch) locally with LoRA, on real pairs plus synthetic documents generated from
   real layouts with invented values. It is trained to answer in a compact format with a short
   instruction, so both the prompt and the answer shrink. Convert to GGUF, quantise, and gate on the
   enlarged benchmark. Target: today's accuracy at a median of ≤ 15 s on the node.

Hardware (a GPU, or an Apple-silicon node serving the model over Metal) remains the alternative that
needs no ML work; the comparison is recorded so the choice can be made on numbers.

## User Stories

### Phase 0 — measure where we are

1. As the developer, I want the model's median prompt and answer times on the production node, taken
   from the queue's per-stage records, so that every later phase is compared against real numbers,
   not M4 numbers.
2. As the developer, I want a benchmark run that executes on the node itself (not the M4), so that
   speed results reflect the hardware documents are actually read on.
3. As the developer, I want the hardware alternative measured once (the 4B on an Apple-silicon Mac over
   Metal, or a GPU if available), so that the cost of training can be weighed against the cost of a
   machine.

### Phase 1 — speculative decoding

4. As the developer, I want the benchmark to run the current model with prompt-lookup decoding
   enabled, so that I know its speed and accuracy on our documents.
5. As the developer, I want the benchmark to run the current model with Qwen3-0.6B as a draft model,
   so that I can compare it with prompt-lookup.
6. As the developer, I want the draft acceptance rate reported per run, so that I can see why a
   setting helps or not.
7. As the developer, I want the answers compared field by field with the baseline's, so that any
   accuracy change from speculative decoding is visible (greedy decoding should be output-identical,
   but llama.cpp's batch-size-dependent logits may differ).
8. As the developer, I want the adopted setting expressed only in the extractor's deployment and the
   request body, so that turning it off is a config change.
9. As an operator, I want the memory cost of a draft model known before adoption, so that the node's
   limits are not exceeded.
10. As an accountant, I want documents read faster at month start without any change in what is read,
    so that the speed-up costs nothing in accuracy.

### Phase 2 — training pairs and a real benchmark

11. As the developer, I want every model read to store the exact text sent to the model, so that the
    input of a training pair is exactly what the model saw.
12. As the developer, I want every model read to store the pipeline version, the model id and the raw
    answer, so that pairs can be filtered and compared by how they were produced.
13. As the developer, I want a document's training label to be its confirmed values for the model's
    fields, so that the label is human-verified.
14. As the developer, I want a label field kept only when its confirmed value occurs in the input text
    (after the same normalisation the grounding check uses), else labelled empty, so that the model is
    never taught to produce values that came from a register, the profile or a derivation rather than
    the document.
15. As the developer, I want documents read deterministically (ISDOC, MOL, eKasa lookup) excluded from
    the pairs or marked as such, so that the dataset reflects what the model must do.
16. As the developer, I want a dataset export that writes train and test files from confirmed
    documents, so that training and benchmarking need no database access.
17. As the developer, I want the test split held out by client company (no client in both), so that the
    benchmark measures generalisation, not memorised suppliers.
18. As the developer, I want the test split stratified by document type (issued, received, receipts,
    other; SK and CZ; scans and text layers), so that rare kinds are represented.
19. As the developer, I want the benchmark harness to score a model against the exported test split
    with the existing metrics (exact-or-flagged, wrong-but-plausible, wrong amount with passing
    arithmetic) and confidence intervals, so that small differences are not over-read.
20. As the office, I want the dataset files to stay on the developer's machine and the cluster, never
    in git or a cloud service, so that client data does not leave our control.
21. As the developer, I want documents an accountant later corrects after confirming to update their
    label, so that the dataset follows the latest truth.
22. As the developer, I want a count of available pairs on the queue or settings screen (developer
    section), so that I know when phase 3 can start.

### Phase 3 — synthetic data and the fine-tune

23. As the developer, I want a synthetic document generator that fills real layouts (from the corpus's
    most common suppliers and invoicing tools) with invented but valid values, so that rare cases are
    covered without more client data.
24. As the developer, I want generated subjects to have valid IČO checksums, DIČ and mod-11 IČ DPH
    numbers, so that the checks treat them as real.
25. As the developer, I want generated documents to cover multiple VAT rates, advance-settled invoices,
    reverse charge, Czech documents, credit notes and receipts, so that the fine-tune sees cases the
    real corpus has few of.
26. As the developer, I want synthetic documents rendered to PDF and passed through the same text-layer
    and OCR path as real ones, so that their input text carries the same noise.
27. As the developer, I want synthetic documents never in the test split, so that the benchmark
    measures real documents only.
28. As the developer, I want a compact answer format for the fine-tuned model (short keys, no
    whitespace, a fixed field order, constrained by a grammar), decoded by the extractor adapter into
    the same payload the app reads today, so that nothing downstream changes.
29. As the developer, I want a short instruction for the fine-tuned model instead of today's long
    instructions and schema, so that the prompt shrinks too.
30. As the developer, I want a reproducible local fine-tune recipe (LoRA on the M4, base model,
    hyperparameters, data mix, seed) checked in without data, so that a model can be rebuilt.
31. As the developer, I want the fine-tuned model converted to GGUF and quantised at Q8_0 and Q4_0, so
    that both can be benchmarked for the speed/accuracy trade-off.
32. As the developer, I want the fine-tune accepted only if it matches or beats the current model on
    the held-out real benchmark and reaches a median of ≤ 15 s on the node, so that speed never costs
    accuracy.
33. As the developer, I want the chosen model's id recorded on every document it reads, so that a
    regression can be traced to the model.
34. As an operator, I want switching between the current and the fine-tuned model to be one config
    change (model file and extractor mode), so that a rollback takes minutes.
35. As the developer, I want a retraining run documented for when the payload schema changes, so that a
    schema change is not blocked by an untrainable model.
36. As an accountant, I want the switch to the fine-tuned model not to re-read documents already read,
    so that confirmed work is not disturbed.

## Implementation Decisions

### Phase 0
- The node baseline comes from the queue's per-stage records (prompt and answer stages, tokens) over
  at least 100 model reads; reading production is done by the user or with their explicit permission.
- The benchmark harness gains a mode that runs as a one-off job on the cluster against the extractor
  service, writing results to the worker's volume, so speed is measured on the node.

### Phase 1 — speculative decoding (amends ADR 0017)
- Two candidates, benchmarked with the current model, prompt and schema: llama.cpp prompt-lookup
  (n-gram) speculation, and draft-model speculation with Qwen3-0.6B Q8_0 (same tokenizer family). The
  exact server flags are taken from the llama.cpp build the extractor image pins; the image is pinned
  to a version that supports them.
- `cache_prompt` stays off and `--cache-ram 0` stays (ADR 0017's determinism reasoning is unaffected:
  speculation verifies within one request).
- Adoption bar: accuracy metrics within the benchmark's noise of the baseline (no new wrong-amount,
  wrong-but-plausible not higher), median model time at least 25% lower on the node, memory within the
  extractor's limit.
- The model lane's slot sizing (`/props`) is unchanged.

### Phase 2 — training pairs
- **Model-read record (schema).** Per model read: the exact model input text (the lines after trimming,
  as sent), pipeline version, model id, extractor settings fingerprint, raw answer, prompt and answer
  token counts. Stored with the document (a new column or a side table keyed by document and read
  attempt; only the latest read per document is needed for training). Text is bounded by the existing
  context cap.
- **Label builder (new pure module, deep).** Input: model input text, the document's confirmed values
  with their provenance, the extracted payload. Output: the label in the model's field set, each field
  either the confirmed value (when grounded in the text, or confirmed with provenance `confirmed` and
  grounded) or empty. Non-grounded values (register, profile, directory, derived) become empty. Pure,
  table-tested.
- **Dataset export (script).** Reads confirmed, model-read documents; applies the label builder; splits
  by client company (deterministic hash of the company's Drive folder id) into train and test with
  stratification; writes JSONL plus a manifest (counts by type, split, pipeline version) into the
  gitignored private fixtures area. Never runs in the web or worker process.
- **Benchmark harness.** Accepts the exported test split as a fixture source, alongside today's 17
  Omega-labelled documents (which stay as a regression set). Reports bootstrap confidence intervals for
  the headline metrics.

### Phase 3 — synthetic data and fine-tune (introduces ADR 0024)
- **Synthetic generator (script, deep module inside).** Layout templates derived from real documents'
  structure (labels, field order, table shapes), filled from a value generator (subjects with valid
  identifiers, addresses, dates, VAT rows that add up, settlement rows, CZ/SK variants). Output: PDF,
  rendered and passed through the app's own text extraction or OCR to produce input text, plus the
  generated label. Synthetic share of the training mix is a hyperparameter, starting at ≤ 50%.
- **Compact answer format.** A grammar (GBNF) fixes key order, short keys and separators; the
  extractor adapter gains a decoder from the compact answer to today's model payload. The adapter
  chooses prompt and decoder by extractor mode (`general` today, `tuned` for the fine-tune), so both
  models can run behind the same code.
- **Training.** LoRA on the M4 (MLX), base Qwen3-1.7B (then 0.6B), merged and converted to GGUF,
  quantised Q8_0 and Q4_0. Recipe and configs are checked in; data and weights are not. Weights live on
  the developer's machine and the extractor's model volume.
- **Gate.** On the held-out real test split: exact-or-flagged ≥ the current model's, wrong-but-plausible
  ≤ the current model's (and ≤ 2%), zero wrong amounts with passing arithmetic; median model time on
  the node ≤ 15 s; memory ≤ the current model's.
- **Rollout.** Config only: model file, extractor mode, model id. Documents already read are not
  re-read (no pipeline version bump unless the payload changes).
- **Privacy.** Training, data and weights stay local (developer machine, cluster). No hosted
  fine-tuning or hosted labelling without the office's written agreement. The fine-tuned weights are
  treated as derived from client data and not published.

## Testing Decisions

- Good tests check behaviour through interfaces: the label builder's output for given text and
  confirmed values; the compact decoder's payload for given answers; the dataset split's properties
  (no company on both sides, stratification). Benchmark runs are experiments with recorded results,
  not unit tests.
- **Label builder:** grounded vs. non-grounded values by provenance, normalisation (spacing in IČO,
  diacritics, decimal comma), empty labels, receipts vs. invoices. Prior art:
  `tests/unit/modules/extraction-checks.test.ts` (grounding), `document-fields.test.ts`.
- **Model-read record:** a model read stores its input text and metadata; a re-read replaces it; a
  deterministic read stores none. Prior art: `tests/unit/extraction-queue/two-lanes.test.ts`.
- **Dataset export:** split is deterministic and company-disjoint; manifest counts. Prior art:
  `tests/unit/modules/benchmark-fixtures.test.ts`, `benchmark-scoring.test.ts`.
- **Compact decoder and extractor mode:** every field round-trips; malformed compact answers fail the
  document like a malformed JSON answer does today. Prior art: the HTTP extractor's tests in
  `tests/unit/adapters/`.
- **Synthetic generator:** generated identifiers pass the app's own checks; VAT rows add up; settlement
  documents are detected by the advance-settlement module. Prior art:
  `tests/unit/modules/subject-integrity.test.ts`, the advance-settlement tests.
- Benchmark results for every phase are written to `benchmark-results/` and summarised in an ADR 0017
  amendment (phase 1) and ADR 0024 (phase 3), as earlier model decisions were.

## Out of Scope

- Buying or provisioning hardware (the comparison is in scope; the purchase is the user's decision).
- Vision-language models reading page images directly (ADR 0017: too slow on CPU).
- Changing OCR (its ~2 s per page is not the bottleneck).
- Hosted models or hosted fine-tuning.
- Line items, or any field the export does not use (ADR 0019).
- Re-enabling prompt caching across requests.
- Porting any reading-lane code to Rust (PRD 0007: nothing worth porting).

## Further Notes

- **Expected gains (estimates, to be measured):** speculative decoding, 1.3–2× on the answer, since
  most answer tokens are copies from the input or JSON structure; a 1.7B fine-tune at Q8_0, ~2–2.5×
  fewer weight bytes than the 4B at Q4_0 (Q4_0 of the 1.7B, ~3.5×); a compact answer ~40% fewer tokens
  (from 328 toward ~200); a short instruction removes most of today's instruction and schema tokens
  from the prompt. Combined, ~48 s → ~10–15 s is plausible but unproven.
- **When to start phase 3:** at ~1,000 confirmed model-read documents across at least 15 clients. With
  PRD 0007's backlog read and the office confirming 2026, that is expected in early 2027.
- **Why not just a bigger benchmark of general models:** the general-model search was done (ADR 0017,
  2026-09-28 and 2026-10-11); nothing smaller than 4B cleared the bar, and newer small general models
  are unlikely to close a 6–8 point gap without task training.
- **Hardware for comparison:** generation speed scales with memory bandwidth. An Apple M4 (~120 GB/s)
  or any recent GPU would run today's 4B several times faster than the node's ~18 GB/s effective, with
  no change to the app beyond `EXTRACTOR_URL`.
