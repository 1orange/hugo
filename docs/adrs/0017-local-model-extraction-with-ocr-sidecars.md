# ADR 0017 — Local model extraction, with OCR, as sidecar services and a checked payload

Date: 2026-09-27
Status: Accepted
Supersedes: ADR 0008's "no OCR engine" decision and its choice of a hosted model for field
structuring
Relates to: ADR 0016 (eKasa receipts), ADR 0018 (company profile and roles), ADR 0004 (single
box), PRD 0002

## Context

Invoice extraction — PRD 0001 slice 11 — was never built. It waited on labelled invoices (slice
10), and everything that is not an eKasa receipt still reaches her as an empty form. That is most
of the corpus: every issued invoice in `01` and received invoice in `02` (99 of 100 carry a text
layer), plus the tickets and ride-hailing invoices filed among receipts.

ADR 0008 planned a hosted model for the structuring step at under €0.20 a month. **The reason to
change is privacy, not cost.** These are her clients' financial documents, held under professional
confidentiality. EU hosting under a processing agreement was considered, and the problem is not
the law but trust: there is no provider she and we can confidently vouch for. A model running on a
machine we control removes the question, and it can be iterated on for free on a laptop.

The hardware is known:

- **Iteration:** an M4 MacBook with 32 GB, running everything in Docker.
- **Deployment, still to be chosen:** an N100 mini PC with 16 GB, or an Ampere (ARM) node on an
  existing k3s cluster. **Both are CPU-only.**

That makes speed a design constraint. Rough figures for a 0.5–1B model at 4–8-bit on four CPU
cores — estimates, to be replaced by measurements:

| Step | Tokens | Rough time |
|---|---|---|
| Read the prompt: invoice text plus instructions and schema | ~2–3k | ~10–25 s |
| Write the JSON answer | ~300 | ~10–15 s |
| Thinking, if enabled | +500 to 3,000 | +30 s to 2.5 min |

Without thinking, an invoice costs about 30–40 seconds in the background. With it, a month-start
burst of sixty invoices ties up a node for hours, and small models are prone to looping while they
think. Extraction is mostly copying values into labelled fields; the arithmetic belongs in code.

OCR has a small but real share. On the Slovak corpus, after ADR 0016, about three documents in 125
still have neither a text layer nor an eKasa UID: two parking-machine receipts and one scanned
invoice. **Czech receipts raise that share**: Czech EET was abolished in 2023, so every receipt of
a Czech company misses the lookup (ADR 0018).

And the labels already exist. For `spring`, her own firm, Omega's `T01` export of May's issued
invoices matches the six PDFs in `2026_05/01` on every field checked, and Omega's VAT-deduction
register in the same month folder labels 11 of the 16 received-side documents with the supplier's
document number, date, supplier IČ DPH, and base and VAT per rate. These are what she actually
booked, and every month she has already filed adds more.

## Decision

### Where it runs

Two sidecar services, one `docker compose`:

- **A text model server**, `llama.cpp` server or Ollama, speaking the OpenAI-compatible API with
  **JSON-schema-constrained output**, so a malformed answer cannot come back.
- **RapidOCR** (PP-OCR models on ONNX Runtime, Latin recognition covering Slovak and Czech
  diacritics) as a small HTTP service.

The Node app calls them through two ports, `Extractor` and `Ocr`, configured by URL and model
name. Nothing from the ML stack enters the app's process, so **the app itself stays
single-runtime** — the property ADR 0008 protected, now kept by process boundary rather than by
having no OCR at all.

The same compose file runs on the Mac for iteration and on the chosen node for deployment. If the
node is not the box the app runs on, the two are joined by a private tunnel (WireGuard or
Tailscale). Extraction is asynchronous: a document waits in `pending` while the box is down and is
retried on the next sweep, so she is never blocked.

**Thinking is off by default.** Both modes are benchmarked; thinking is adopted only if it clears
the bar below without breaking the time budget.

A small vision-language model is a **benchmark candidate only**. On CPU, encoding a 12-megapixel
photo costs minutes where OCR plus a text model costs seconds.

### When each runs

1. An eKasa receipt goes through ADR 0016 and never reaches the model.
2. A document with a text layer: the text goes to the model.
3. A document with neither a text layer nor a UID: page images or the photo go to OCR. OCR boxes are
   grouped into lines by y-coordinate with `|` between cells — **the same shape `pdf-access.ts`
   produces** — so the model sees one input format and one harness scores both paths. The OCR text
   is searched for an eKasa UID first (ADR 0016); only if none is found does it go to the model.

### What it produces

**One document-agnostic payload**, `kind: "extracted"`, `source: "model"`:

- `parties[]`: name, IČO, DIČ, IČ DPH or VAT ID — **without roles**. Which party is the supplier
  is decided by code from the company's own IČO (ADR 0018), not by the model.
- `documentNumber`, `variableSymbol`
- `issueDate`, `taxableSupplyDate` (DUZP), `dueDate`
- `currency`, `total`, and a VAT summary per rate: rate, base, VAT
- `docTypeHint`: `invoice | receipt | proforma | credit_note | advance_tax_document | other`.
  A proforma hint lets the screen say "looks like a proforma"; she still decides (ADR 0010). A
  credit note means negative amounts, which the checks allow.

**No line items from the model.** They are not in the export field set (ADR 0019), and on CPU they
are the most expensive part of the answer: a 30-line invoice adds about a thousand tokens. Line
items remain wherever they are free — the eKasa lookup and the text-layer parser.

The eKasa payload and this one feed **one fields panel**, and her confirmed payload gains VS, DUZP,
due date and the parties.

### Correct, flagged or empty — never silently wrong

She confirms every document, so the model's job is to save typing. The danger is a plausible wrong
value she trusts because it was pre-filled: an empty field costs seconds, a wrong IČO or VAT base
costs a correction later. Code, not the model, enforces three kinds of check:

- **Arithmetic.** Base + VAT = total for each rate, and the per-rate sums equal the total. A
  failure flags the amounts.
- **Grounding.** IČO, DIČ, IČ DPH, VS, document number and IBAN must occur literally in the source
  text, after whitespace normalisation. A value that does not is dropped. This removes invented
  values outright, which is the characteristic failure of small models.
- **Format.** IČO checksum; `SK` + 10 digits for a Slovak IČ DPH and the `CZ` form for a Czech
  VAT ID; IBAN mod-97; dates that parse and fall near the document's month; VAT rates valid for
  the **issuer's** country, not the company's (SK 23/19/5, CZ 21/12).

Every field therefore ends in one of three states: **correct, flagged, or empty.**

### The adoption bar

A model — any size, any mode — is adopted only if, on the labelled set:

- **no amount that passes the arithmetic check is wrong**;
- **at least 90%** of the other fields are exactly right or empty-and-flagged;
- **at most 5%** are wrong-but-plausible;
- the **median time per document is 60 seconds or less, CPU-only.**

Timing is measured **in Docker, not natively.** Docker on macOS runs a Linux VM with no access to
the Apple GPU, which approximates the CPU-only ARM64 node; native Ollama uses Metal and would make
any model look fast. Accuracy is hardware-independent and can be measured either way.

### The labels

The benchmark is built from **Omega's own outputs**, not from labels anyone drafts:

- Her `T01` export (`docs/reference/omega/eport OF .txt`) for issued invoices.
- The *evidencia DPH – Odpočítanie dane* register PDF in each month folder for received documents.

Two scoring rules follow from what those sources contain:

- **Reverse-charge and intra-EU documents** (KV DPH section `B1` — Kaspersky and Bonami in
  `spring` May) show VAT she self-assessed, which is not printed on the invoice. They are scored on
  the base only.
- **Receipt dates are not scored.** She books by her own date: Zamkni's receipt is printed
  30.04.2026 and booked 01.05.2026.

It starts with the 17 documents the two sources cover for `spring` May. The five `spring` May
documents with no deductible VAT are added when she exports *Doklady EUD*. The fixtures contain
real supplier and client data and stay out of any public remote. The harness runs on demand, never
in the normal test suite.

## Consequences

- **No document leaves machines we control**, and there is no model API key to hold. ADR 0004's
  list of secrets on the box shrinks accordingly.
- **A second runtime exists, but not in the app.** Deployment gains a compose file and possibly a
  tunnel; the app gains two HTTP ports with stubs for every test.
- **The model is configuration.** Swapping a 0.5B model for a larger one is a URL and a name, not
  a code change, and the harness says whether it was worth it.
- **Quality risk is real and bounded.** A small model will be worse at Slovak layouts than a large
  hosted one. The checks turn most of that into empty or flagged fields rather than wrong ones, and
  the bar decides whether it ships at all.
- **The labelled corpus grows on its own.** Every filed month adds Omega's registers, and after
  go-live the same comparison — what the app extracted against what she booked — becomes an
  accuracy monitor.
- **Supplier-versus-customer is not the model's problem**, which removes the classic small-model
  failure the grounding check cannot see (ADR 0018).
- ADR 0008's deferral trigger, "real counts across all her clients", is retired: Czech companies
  alone make OCR necessary, and it ships alongside the model rather than after it.

## Alternatives considered

- **EU-hosted model under a processing agreement** (Claude on AWS Bedrock in Frankfurt, Mistral).
  Better quality, pennies a month. Rejected on trust rather than law.
- **Hosted vision model on every page.** Simplest pipeline; everything leaves the box.
- **OCR and model inside the Node process** (`onnxruntime-node`, `node-llama-cpp`). Saves a hop but
  puts native dependencies and gigabytes of RAM pressure into the web app, and makes the model
  harder to swap.
- **PaddleOCR with the PaddlePaddle framework.** About 500 MB against RapidOCR's 50–80 MB, for the
  same models.
- **A small vision-language model instead of OCR.** Kept as a benchmark candidate; too slow on CPU
  to be the default.
- **Drafting labels by hand, or with a hosted model.** Unnecessary once Omega's own outputs turned
  out to be ground truth, and the second would send invoices off the box.
- **Fine-tuning.** Still needs hundreds of labelled documents, and the bar may be met without it.

### Amendment, 2026-09-27: model choice (measured 2026-09-28)

Slice 11 runs the slice 10 harness against several local text models on the **M4 MacBook in Docker,
CPU-only** (same constraint as deployment). Accuracy does not depend on Metal; timing must not be
measured with native Ollama on Metal.

#### How to run the comparison

1. **Fixtures** — private Omega labels under `tests/private-fixtures/benchmark` (slice 09), each
   beside its document as `<driveFileId>.pdf` (or `.jpg`); the harness reads the file as the app
   does. Never commit them.
2. **Weights** — download the GGUF files into `./models/`, gitignored. The candidates are **Qwen3**,
   because it can switch thinking on and off per request; Qwen2.5, listed here first, has no
   thinking mode, so its "thinking on" rows would have measured nothing. From the official `Qwen/`
   repositories on Hugging Face: `Qwen3-0.6B-Q8_0.gguf` (0.64 GB), `Qwen3-1.7B-Q8_0.gguf` (1.83 GB)
   and `Qwen3-4B-Q4_K_M.gguf` (2.50 GB) — 8-bit for the two small models, which lose most from
   heavier quantisation. `npm run benchmark:download-models` fetches all three. Filenames must
   match `scripts/benchmark-models.env`.
3. **Compose env** — `cp .env.docker.example .env.docker`, adjust `EXTRACTOR_THREADS` if needed (4
   matches the deployment assumption).
4. **Candidate list** — `cp scripts/benchmark-models.env.example scripts/benchmark-models.env`.
   Edit rows to match files you actually downloaded; keep **at least three model sizes**, each with
   **thinking off and on** (six runs minimum for the full matrix; the example lists 0.6B, 1.7B, 4B).
   The switch is sent as `chat_template_kwargs.enable_thinking`, which `llama.cpp` honours with
   `--jinja`; the harness reports median completion tokens, so a thinking row that generates no
   more tokens than its "off" twin did not actually think (JSON-schema grammar can suppress it).
5. **Run** — from the repo root, with Docker running:

   ```bash
   npm run benchmark:compare-models
   ```

   This starts the `ocr` service for the scans, restarts the `extractor` service per row, waits for
   `/health`, runs `npm run benchmark -- --real` under `caffeinate` (an idle Mac slept mid-request
   once), and writes `benchmark-results/<timestamp>/summary.tsv` plus one log per candidate.

   Single candidate manually:

   ```bash
   docker compose --env-file .env.docker up -d extractor
   EXTRACTOR_URL=http://127.0.0.1:8080/v1 EXTRACTOR_MODEL=local EXTRACTOR_THINKING=false \
     npm run benchmark -- --real
   ```

6. **Memory** — after each run the script records `docker stats` for the compose `extractor`
   container. Note peak RSS during the slowest document if planning a 16 GB node (slice 14); the
   table column is a snapshot, not a peak sampler.

#### Results, 2026-09-28

Corpus: SPRING's May 2026, 17 documents — 6 issued invoices, 9 received invoices and receipts with
a text layer, 2 scans read by OCR. Measured on an M4 MacBook in Docker (4 vCPUs, CPU-only), one
request at a time, `llama.cpp` with `cache_prompt: false` and `--cache-ram 0`. Each row's answers are
saved beside its log (`benchmark-results/20260928T150701/`, `…T164336/`) and every row below is
re-scored with the same labels and scoring (`--rescore`).

| Label | Thinking | OCR | Exact or empty-flagged | Wrong-but-plausible | Amount wrong ∧ arith OK | Median (s) | Worst (s) | Median tokens | Docker mem | Bar |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| Qwen3-0.6B Q8_0 | off | v4 | 65.2% | 8.2% | 0 | 10 | 21 | 383 | 2.2 GiB | FAIL |
| Qwen3-0.6B Q8_0 | on | v4 | 59.5% | 5.1% | 0 | 29 | 524 | 876 | 2.2 GiB | FAIL |
| Qwen3-1.7B Q8_0 | off | v4 | 86.1% | 1.3% | 0 | 28 | 600 | 332 | 2.8 GiB | FAIL |
| Qwen3-1.7B Q8_0 | on | v4 | 86.1% | 5.7% | 0 | 98 | 156 | 1587 | 4.5 GiB | FAIL |
| Qwen3-4B Q4_K_M | off | v4 | 92.4% | 1.3% | 0 | 50 | 68 | 324 | 3.7 GiB | PASS |
| Qwen3-4B Q4_K_M | on | — | stopped | | | ≈ 170–380 | | | | FAIL (time) |
| **Qwen3-4B Q4_K_M** | **off** | **v6** | **93.0%** | **1.3%** | **0** | **50** | **69** | **323** | **3.6 GiB** | **PASS** |
| Qwen3-1.7B Q8_0 | off | v6 | 88.0% | 1.3% | 0 | 23 | 36 | 330 | 2.8 GiB | FAIL |

OCR v4 is the Chinese/English model the sidecar first shipped; v6 is PP-OCRv6 (note below) — it
changes the two scans only. The 4B with thinking on was stopped after its first document: 3,402
tokens in 406 s, at 9 tokens a second. With the 1.7B's thinking median of ~1,600 tokens it costs
170–380 s a document, past the 60 s median whatever it scores. Thinking did not help the model
sizes it could be measured on: the 1.7B kept its accuracy, tripled its tokens and made more
plausible mistakes. The 600 s and 524 s worst times are models that never finished — the 1.7B
looping on the Zamkni scan's v4 text, the 0.6B thinking until its context was full on In-Green —
and fail the document, not the run.

What the 4B still gets wrong, by kind: Bonami's taxable supply date taken from its due date, and
wrong-but-flagged values the checks caught (a Czech IČ DPH, recaps that do not add up). Two
"wrong" names are her own short names, not the invoice's: `UPC BROADBAND` for UPC BROADBAND
SLOVAKIA, `Kaspersky` for the reseller 2Checkout.

#### Decision

- **Model file:** `Qwen3-4B-Q4_K_M.gguf`, the only row that clears the bar.
- **Thinking:** off (`EXTRACTOR_THINKING=false`). No row gained accuracy from it, and on the 4B it
  costs several times the time budget.
- **Deployment (slice 14):** the 50 s median is on an M4's cores. The N100 and the Ampere node are
  slower per core; the bar must be measured again on the node that will run it before
  `EXTRACTOR_URL` is set there. Until it passes there, leave `EXTRACTOR_URL` unset in production so
  documents wait — the stub is refused there, and an unconfigured model never marks a document done.
- **Memory:** 3.6 GiB for the model with an 8192-token context, the host prompt cache off.

### Note, 2026-09-27: arithmetic accepts the legal cash rounding

The arithmetic check accepts a total that is exactly the legal cash rounding of base + VAT for the
document's currency — 5 cents in EUR, a whole koruna in CZK — and nothing else. A Czech cash receipt
of 99.60 paid as 100 Kč is therefore correct, not flagged. The rule and its reasoning are in ADR
0016's amendment of the same date.

### Note, 2026-09-27: the model reads every page, up to five

The model received only a PDF's first page, because it shared the eKasa parser's text extraction. It
now gets pages 1–5 — the O2 invoice grows from 45 to 75 lines — including an invoice filed with the
receipts that falls through to the model. The cap bounds CPU time on long itemisations, which the
export never needs; every invoice in the corpus fits.

### Note, 2026-09-28: the model reads a page a column at a time

Text was grouped by height alone, so an invoice's supplier and customer columns reached the model
interleaved: on her ABC invoice SPRING's IČO sat under "Odberateľ:". The model now reads a page
block by block — the page cut along its whitespace, left column before right, an empty line where
a column ends. Two sides whose lines share baselines, a label and its value or a table's cells,
stay rows. On the May set, Qwen3 0.6B with the same prompt got 104 of 160 fields exact instead of
84, and 14 wrong-but-plausible instead of 20. The eKasa parser and the VAT register import keep
rows. OCR'd pages are read the same way; before this they were also read bottom-up, the sidecar's
image pixels sorted as PDF points.

The same measurement found two things that made an answer depend on more than the document. The
prompt carried the folder month, which the model returned as the document number; it is gone, and
the checks alone compare dates with the month. `llama.cpp` reused the previous request's matching
prompt prefix, whose logits are not bit-identical to a fresh evaluation, so her issued invoices —
which share a long opening — got answers that depended on which one was read before; requests send
`cache_prompt: false`, and the host prompt cache is off (`--cache-ram 0`), which also kept 4 GB
of RAM from accumulating over a run.

The benchmark reads each labelled document's own file — `<driveFileId>.pdf` or an image beside its
label — through the function the pipeline uses, so it scores the text the app sends.

### Note, 2026-09-28: OCR reads Slovak and Czech; labels hold only what her records hold

**OCR.** The sidecar shipped `rapidocr-onnxruntime` 1.4.4, whose default recogniser is Chinese and
English, not the Latin recognition this ADR calls for. Her 15 text-layer invoices, rendered and
OCR'd against their own text layer, measure it: it read 0.1% of the words with diacritics and 65.8%
of the numbers. `rapidocr` 3.9.2 with **PP-OCRv6 small**, whose multilingual models list Slovak and
Czech, reads 93.2% of words, 87.7% of words with diacritics and 96.0% of numbers, at 2.1 s a page.
PaddleOCR's PP-OCRv5 Latin recogniser scored alike on the rendered pages but dropped the Č of
"IČO" and "IČ DPH" on her real scan, the labels that tell an IČO from a DIČ. The models are fetched
when the image is built.

**Labels and scoring.** Measuring the models found the benchmark marking correct readings wrong.
Each correction has its evidence in the commit that made it:

- her VAT register has no variabilný symbol and no issue date — its dates are when the tax arose
  and when she deducted it — so received labels no longer copy the document number and the
  taxable date into them (UPC prints VS 9643266 for document 218904645, issued 13.5 for a supply on
  11.5); a receipt's row carries only her own number (IDk26007), not the printed one;
- the register prints a partner's name in 15 characters (`Grand hotel Per`); a name that starts
  with it matches;
- a VAT split within a cent of her books, with exactly her total, is the invoice rounding
  differently (UPC prints 14.92 + 3.42 = 18.34; she booked 14.91 + 3.43), not a misread;
- a wrong value the checks flagged is not wrong-but-plausible; no recap rows is an empty recap;
  identifiers compare without spacing and names without their legal form.

Of the fields the first correction removed from the 4B's score, nine were correct readings counted
wrong and eight were counted exact.

**Requests.** The answer is streamed — unstreamed, Node's fetch gave up after 300 s without headers
and a slow document read as an unreachable model, waiting for ever. A document has a deadline
(`EXTRACTOR_TIMEOUT_MS`, ten minutes) and, without thinking, a token cap (`EXTRACTOR_MAX_TOKENS`,
2048); past either it fails with the reason.
