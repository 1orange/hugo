# OCR and deterministic extraction experiment — 2026-10-11

The first conservative rules parser is fast but cannot replace Qwen3 Q4_0.
It remains an isolated experiment; production extraction is unchanged.

## Labelled development set

Reparsed the baseline recording's text for the same 17 Omega-labelled PDFs.
This reuses the text-layer/OCR input and existing checks; it does not measure
fresh OCR accuracy or a production bypass rate. The development set has
158 scored fields. Parser latency is native JavaScript parsing only, not
Docker model inference.

| Metric | Deterministic prototype | Qwen3 Q4_0 baseline |
|---|---:|---:|
| Exact fields | 100 | 150 |
| Empty and flagged fields | 17 | 2 |
| Exact or empty flagged | 74.1% | 96.2% |
| Silent wrong fields | 5 (3.2%) | 3 (1.9%) |
| Wrong amount while arithmetic passed | 0 | 0 |
| Parsing/model latency | Worst approximately 4 ms | Median 29.2 seconds |

The parser fails the adoption bar. Rules currently handle explicit labelled
identifiers/dates, explicitly labelled invoice totals, party blocks and two
VAT recap layouts. Conflicting matches are left empty. It does not infer a
missing tax row, treat an invoice's balance after deposits as its total, or
read a line item's VAT columns as the recap. Five silent errors still remain,
so absence of a wrong arithmetic-passing amount is not proof of reliability.

Repeat:

```bash
npm run benchmark -- --deterministic-from benchmark-results/20261011T202449/Qwen3-4B_Q4_0_baseline.payloads.json
```

This mode does not call the model or OCR. Reported OCR times are historical;
completion-token counts are omitted for the rules parser.

## Downloads corpus

Audited `/Users/jean/Downloads/mix dokladov`: 40 PDFs, 38 without text layers,
2 with text layers, no embedded ISDOC/MOL invoice data. All 40 produced text
through the existing local OCR/text-layer pipeline without extraction failures.
No document was sent to an external inference service. Source PDFs were not
modified. No matching verified labels were identified in this folder.

Two fresh local passes:

| Input representation | Median reading + parsing | PDFs with parsed total | PDFs with VAT recap | PDFs with party identifier |
|---|---:|---:|---:|---:|
| Model reading-order text | 2.53 seconds | 1 | 0 | 2 |
| Row-preserving OCR/text layer | 2.48 seconds | 0 | 0 | 2 |

These are coverage figures, not correctness scores. Both use the deliberately
narrow parser above. They do not demonstrate that deterministic parsing in
general cannot work. The second pass saves OCR boxes and both text orders so
we can inspect layout and annotate values without repeating OCR. Some sample
PDFs bundle invoices and payment receipts, repeating amounts and identifiers;
page/document grouping must precede reliable assignment of parties and totals.
Flattened row text alone did not solve the problem.

Private artifacts, gitignored:

- `benchmark-results/deterministic-mix-20261011/`
- `benchmark-results/deterministic-mix-rows-20261011/`

Each contains `summary.json` and `unverified-extractions.json`. Parsed values
are explicitly `verified: false`; they are not training labels. The audit
reports coverage without applying company/month checks, since those contexts
are unknown for the mixed documents. All values require review.

Repeat the row-preserving audit:

```bash
OCR_URL=http://127.0.0.1:8090 node --import tsx scripts/audit-deterministic-extraction.ts '/Users/jean/Downloads/mix dokladov' benchmark-results/deterministic-mix-new
```

The existing local OCR sidecar must be running. This writes sensitive OCR text
and identifiers to the specified private output directory.

## A custom small model

A pilot is feasible, but there is no trained custom model in this experiment.
Forty unlabelled PDFs add layouts and scans, not supervised examples. The
17 existing documents provide partial accounting labels and are already used
as a development benchmark; they are not an untouched final test set.

Prefer a small candidate-selection model or fine-tuned multilingual field
encoder over training a generative language model from scratch:

1. Group pages/documents; classify invoice versus payment receipt and other
   documents. Preserve page indices and OCR boxes.
2. Annotate printed totals, dates, document numbers, party identifiers and
   VAT rows against source spans. Distinguish invoice total from outstanding
   balance, and printed values from bookkeeping choices in Omega.
3. Enumerate source candidates with label proximity, position and table
   features. A small classifier can select a candidate or abstain. A
   multilingual token-classification model is an alternative if rules and
   simpler features reach a ceiling.
4. Reserve suppliers/layouts for evaluation, keep duplicate invoices and
   payment receipts in the same split, and expand beyond this pilot before
   claiming general performance. Measure learning curves rather than assuming
   a fixed number of PDFs is sufficient.
5. Run grounding, format and arithmetic checks independently. Benchmark
   exact fields, silent errors, amount errors, abstention and end-to-end CPU
   latency. Keep Qwen/manual review as fallback until measured bypass rules
   meet the existing adoption bar on unseen documents.

Hugging Face documents pretrained
[token classification with LoRA](https://huggingface.co/docs/peft/main/task_guides/token-classification-lora)
and [layout-aware field extraction with LayoutLMv3](https://huggingface.co/docs/transformers/main/model_doc/layoutlmv3).
These establish supported approaches, not a recommendation that either model
already works for these Slovak/Czech scans.

Validation: 26 relevant unit tests passed, including seven new parser tests;
TypeScript compilation passed with incremental writes disabled. The parser
and audit are not connected to the production extraction pipeline.
