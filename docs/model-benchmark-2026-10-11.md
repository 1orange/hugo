# Local extraction model benchmark — 2026-10-11

Keep Qwen3-4B Q4_0. None of the three alternatives improved extraction on
the current pipeline and the 17 private Omega-labelled documents.

Docker on the M4 MacBook, CPU-only, four model threads, 8192-token context,
one request at a time, thinking off, temperature zero, identical prompt and
JSON schema. OCR was the existing RapidOCR sidecar. No documents were sent
to external inference services.

| Model | Exact fields / 158 | Empty flagged | Exact or empty flagged | Silent errors | Wrong amount with arithmetic passing | Median / worst model seconds | Bar |
|---|---:|---:|---:|---:|---:|---:|---|
| Qwen3-4B Q4_0 baseline | 150 | 2 | 96.2% | 1.9% | 0 | 29.2 / 40.6 | PASS |
| Qwen3-4B-Instruct-2507 Q4_0 | 148 | 1 | 94.3% | 3.8% | 1 | 31.8 / 46.4 | FAIL |
| Qwen3.5-4B Q4_K_M | 115 | 2 | 74.1% | 2.5% | 0 | 40.0 / 62.2 | FAIL |
| LFM2.5-1.2B-Instruct Q8_0 | 78 | 3 | 51.3% | 10.1% | 1 | 11.6 / 19.3 | FAIL |

The combined score includes safe omissions, so it is not an exact-accuracy
percentage. Exact counts are reported separately. Seventeen documents are
a small development set, not evidence of general performance across all
suppliers. The baseline's exact-field rate is 150/158 = 94.9%.

Local artifacts: `benchmark-results/20261011T202449` (baseline and Qwen3.5)
and `benchmark-results/20261011T205451` (Instruct-2507 and LFM2.5). They
contain sensitive invoice values and remain gitignored. The first runner
skipped the new weights before download finalization; both were measured
in the second run. Editing the running shell script caused a trailing shell
error after the first two complete runs; the saved logs and payloads were
preserved. The second comparison completed normally.

Repeat with:

```bash
MODELS_ENV=scripts/benchmark-models-20261011.env npm run benchmark:compare-models
```

The comparison summary now records exact fields and flagged omissions
separately and includes the 60-second median time rule in the overall result.
Benchmark scoring and fixture tests passed (15 tests); shell syntax checks
passed for both runner and downloader.

## Next candidates and OCR

- [LFM2-2.6B](https://huggingface.co/LiquidAI/LFM2-2.6B): a larger CPU-focused
  hybrid model; the 1.2B result does not establish its extraction quality.
- [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
  Q8_0: isolate quantization loss, at higher RAM and latency cost.
- [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) Q4: measure a larger
  model's accuracy/latency tradeoff rather than assuming it meets the CPU bar.
- [LightOnOCR-2-1B](https://arxiv.org/abs/2601.14251): document-specialized
  image-to-text inference; CPU speed and integration still need measurement.

Existing OCR is PP-OCRv6 small via RapidOCR. ADR 0017 records a prior OCR-only
comparison on 15 rendered invoices: 93.2% of words, 87.7% of words with
diacritics, 96.0% of numbers, 2.1 seconds per page. PP-OCRv5 Latin mobile
performed similarly on rendered pages but missed the Č in key labels on a
real scan. These are prior results, not fresh OCR measurements in this run.
[PP-OCRv5 supports Czech and Slovak](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html).

Classical OCR supplies text and boxes; it does not replace mapping text into
invoice fields. PDFs with usable text layers already skip OCR. For an OCR
comparison, hold Qwen3 Q4_0 fixed, use identical scan preprocessing, and
measure numeric/diacritic recognition plus final field accuracy and total
latency. Rendered text-layer PDFs supply transcription references; include
real scans as a separate group. Specialized generative OCR may recover
layout better, but a small parameter count does not guarantee faster CPU
inference than the current recognition pipeline.
