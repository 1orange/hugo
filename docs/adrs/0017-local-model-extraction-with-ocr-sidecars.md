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

### Amendment, 2026-09-27: model choice (measurement — fill the table on the Mac)

Slice 11 runs the slice 10 harness against several local text models on the **M4 MacBook in Docker,
CPU-only** (same constraint as deployment). Accuracy does not depend on Metal; timing must not be
measured with native Ollama on Metal.

#### How to run the comparison

1. **Fixtures** — private Omega labels under `tests/private-fixtures/benchmark` (slice 09). Never
   commit them.
2. **Weights** — download GGUF quantisations (start with `Q4_K_M`) into `./models/`, gitignored.
   Hugging Face IDs used for the candidate set below are the usual `Qwen2.5-*-Instruct` releases;
   filenames must match `scripts/benchmark-models.env`.
3. **Compose env** — `cp .env.docker.example .env.docker`, adjust `EXTRACTOR_THREADS` if needed (4
   matches the deployment assumption).
4. **Candidate list** — `cp scripts/benchmark-models.env.example scripts/benchmark-models.env`.
   Edit rows to match files you actually downloaded; keep **at least three model sizes**, each with
   **thinking off and on** (six runs minimum for the full matrix; the example lists 0.5B, 1.5B, 3B).
5. **Run** — from the repo root, with Docker running:

   ```bash
   npm run benchmark:compare-models
   ```

   This restarts the `extractor` service per row, waits for `/health`, runs `npm run benchmark --
   --real`, and writes `benchmark-results/<timestamp>/summary.tsv` plus one log per candidate.

   Single candidate manually:

   ```bash
   docker compose --env-file .env.docker up -d extractor
   EXTRACTOR_URL=http://127.0.0.1:8080/v1 EXTRACTOR_MODEL=local EXTRACTOR_THINKING=false \
     npm run benchmark -- --real
   ```

6. **Memory** — after each run the script records `docker stats` for the `extractor` container. Note
   peak RSS during the slowest document if planning a 16 GB node (slice 14); the table column is
   a snapshot, not a peak sampler.

#### Results (Filip — replace placeholders after `benchmark:compare-models`)

Corpus: spring May labelled set (17 documents in slice 09). Per-field breakdown is in each
`.log` under `benchmark-results/`. Aggregate columns below come from harness summary lines.

| Label | Thinking | Exact or empty-flagged | Wrong-but-plausible | Amount wrong ∧ arith OK | Median (s) | Worst (s) | Docker mem (snapshot) | Bar |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Qwen2.5-0.5B Q4_K_M | off | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Qwen2.5-0.5B Q4_K_M | on | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Qwen2.5-1.5B Q4_K_M | off | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Qwen2.5-1.5B Q4_K_M | on | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Qwen2.5-3B Q4_K_M | off | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Qwen2.5-3B Q4_K_M | on | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

**Bar column:** PASS only if all four adoption rules pass including median ≤ 60 s in Docker.

#### Decision (provisional until the table is filled)

No benchmark was executed in CI or by the agent (no Docker / no GGUF on disk). **Provisional
defaults** — swap after the table shows a winner:

- **Model file:** `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` (smallest candidate; fits 16 GB with headroom
  for the app and OCR sidecar).
- **Thinking:** off (`EXTRACTOR_THINKING=false`), unless a row with thinking on clears the bar with
  median still ≤ 60 s and strictly better accuracy than the same size with thinking off.
- **Compose / app:** see `.env.docker.example` (`EXTRACTOR_MODEL_FILE`, `EXTRACTOR_MODEL=local`,
  `EXTRACTOR_URL=http://127.0.0.1:8080/v1`).

If **no row passes**, record here which alternative was chosen (larger quant or model, vision
candidate for benchmark only, or keep `EXTRACTOR=stub` in production until one passes) and update
`.env.docker.example` accordingly.

_Agent note: paste `summary.tsv` values into the table, set the Decision section to the adopted row,
and remove “provisional” once measurement is done._

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
