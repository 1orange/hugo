# Sidecars — model + OCR (ADR 0017)

Same `docker-compose.yml` at repo root runs on the sidecar host (laptop for dev, chosen node for prod). See [NODE.md](./NODE.md) for the host decision.

## On the sidecar host

1. Install Docker.
2. Copy repo (or only `docker-compose.yml`, `services/ocr/`, `.env.docker.example`, `models/`).
3. `cp .env.docker.example .env.docker` — set `EXTRACTOR_MODEL_FILE` to the GGUF from ADR 0017 amendment.
4. Place weights under `./models/` (gitignored).
5. Start:

   ```bash
   docker compose --env-file .env.docker up -d extractor ocr
   ```

6. Health:

   ```bash
   npm run smoke:sidecars
   ```

   Requires `EXTRACTOR_URL` and `OCR_URL` pointing at the sidecar (defaults `http://127.0.0.1:8080/v1` and `http://127.0.0.1:8090`).

## App configuration (no code change)

In `/etc/hugo/hugo.env` (or local `.env`):

```bash
EXTRACTOR_URL=http://100.x.x.x:8080/v1   # Tailscale IP of sidecar host
OCR_URL=http://100.x.x.x:8090
EXTRACTOR_MODEL=local
EXTRACTOR_THINKING=false
# Optional: one document's deadline (default 600000, ten minutes). Past it the
# document fails with the reason, instead of waiting as if the model were down.
# EXTRACTOR_TIMEOUT_MS=600000
# Optional: tokens the model may generate (default 2048 without thinking, none
# with it). An answer is ~330 tokens; the cap stops a model that loops.
# EXTRACTOR_MAX_TOKENS=2048
# Optional: the extractor's context size, its `-c` (default 8192). A longer
# document's text is cut to fit — its start and end kept, the middle left out.
# EXTRACTOR_CONTEXT=8192
```

Do **not** set `EXTRACTOR=stub` in production.

## Update model

1. Stop extractor: `docker compose stop extractor`
2. Replace GGUF under `models/`, update `EXTRACTOR_MODEL_FILE` in `.env.docker`
3. `docker compose --env-file .env.docker up -d extractor`
4. `npm run smoke:sidecars`

## Pending documents when sidecar is down

Extraction stays `pending`; next month sweep or opening the workbench retries. No data loss.

## Full end-to-end smoke (manual)

With sidecars up and app pointed at them:

1. Open an editable month with a text-layer invoice → fields fill in background (`source: model`).
2. Open an image-only receipt without eKasa QR → OCR then model (`source: ocr`) or lookup if UID in OCR text.

Use fake/stub sidecars in CI; this check is for the deployed pair only.
