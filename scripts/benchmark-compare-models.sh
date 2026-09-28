#!/usr/bin/env bash
# Loop benchmark candidates from scripts/benchmark-models.env (see .example).
# Requires: Docker, private benchmark fixtures, GGUF files under ./models.
set -euo pipefail

# The matrix runs for an hour or more; an idle Mac sleeps mid-request and the
# pause is counted as model time (one 10 s document measured 155 s).
if [[ "$(uname)" == "Darwin" && -z "${BENCHMARK_CAFFEINATED:-}" ]] && command -v caffeinate >/dev/null; then
  BENCHMARK_CAFFEINATED=1 exec caffeinate -i "$0" "$@"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_ENV="${COMPOSE_ENV:-.env.docker}"
MODELS_ENV="${MODELS_ENV:-scripts/benchmark-models.env}"
FIXTURES_DIR="${BENCHMARK_FIXTURES_DIR:-tests/private-fixtures/benchmark}"
RESULTS_DIR="${BENCHMARK_RESULTS_DIR:-benchmark-results}/$(date +%Y%m%dT%H%M%S)"

if [[ ! -f "$COMPOSE_ENV" ]]; then
  echo "Missing $COMPOSE_ENV — copy from .env.docker.example" >&2
  exit 1
fi
if [[ ! -f "$MODELS_ENV" ]]; then
  echo "Missing $MODELS_ENV — copy from scripts/benchmark-models.env.example" >&2
  exit 1
fi
if [[ ! -d "$FIXTURES_DIR" ]]; then
  echo "Missing benchmark fixtures at $FIXTURES_DIR" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$COMPOSE_ENV"
PORT="${EXTRACTOR_PORT:-8080}"
BASE_URL="http://127.0.0.1:${PORT}/v1"

mkdir -p "$RESULTS_DIR"
SUMMARY="$RESULTS_DIR/summary.tsv"
echo -e "label\tthinking\texact_or_empty_flagged\twrong_plausible\tamount_wrong_arith_pass\tmedian_ms\tworst_ms\tmedian_tokens\tdocker_mem\toverall\tlog" >"$SUMMARY"

wait_for_extractor() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Extractor did not become healthy on port ${PORT}" >&2
  return 1
}

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(echo "$line" | tr -d '[:space:]')"
  [[ -z "$line" ]] && continue

  IFS='|' read -r model_file thinking label <<<"$line"
  if [[ -z "$model_file" || -z "$thinking" || -z "$label" ]]; then
    echo "Bad row (need MODEL_FILE|THINKING|LABEL): $line" >&2
    exit 1
  fi

  safe_label="$(echo "$label" | tr ' /' '__')"
  log="$RESULTS_DIR/${safe_label}.log"
  model_path="${EXTRACTOR_MODEL_DIR:-./models}/${model_file}"
  if [[ ! -f "$model_path" ]]; then
    echo "Skip $label — missing $model_path" | tee "$log"
    continue
  fi

  echo "=== $label ==="
  EXTRACTOR_MODEL_FILE="$model_file" docker compose --env-file "$COMPOSE_ENV" up -d extractor
  wait_for_extractor

  set +e
  EXTRACTOR_URL="$BASE_URL" \
    EXTRACTOR_MODEL="${EXTRACTOR_MODEL:-local}" \
    EXTRACTOR_THINKING="$thinking" \
    npm run benchmark -- --real 2>&1 | tee "$log"
  bench_status=${PIPESTATUS[0]}
  set -e

  # Sampled after the run, once the model is paged in and the KV cache is used.
  # The compose container is named <project>-extractor-1, not "extractor".
  container="$(docker compose --env-file "$COMPOSE_ENV" ps -q extractor 2>/dev/null || true)"
  mem="$(docker stats "$container" --no-stream --format '{{.MemUsage}}' 2>/dev/null || echo 'n/a')"

  exact="$(grep -E 'exact or empty-flagged:' "$log" | tail -1 | sed -E 's/.*: ([0-9.]+%).*/\1/' || true)"
  wrong="$(grep -E 'wrong-but-plausible:' "$log" | tail -1 | sed -E 's/.*: ([0-9.]+%).*/\1/' || true)"
  amount="$(grep -E 'amount wrong while arithmetic passed:' "$log" | tail -1 | sed -E 's/.*: ([0-9]+).*/\1/' || true)"
  median="$(grep -E 'median model time per document:' "$log" | tail -1 | sed -E 's/.*: ([0-9]+) ms.*/\1/' || true)"
  worst="$(grep -E 'worst model time per document:' "$log" | tail -1 | sed -E 's/.*: ([0-9]+) ms.*/\1/' || true)"
  tokens="$(grep -E 'median completion tokens per document:' "$log" | tail -1 | sed -E 's/.*: ([0-9]+|—).*/\1/' || true)"
  overall="$(grep -E 'overall:' "$log" | tail -1 | sed -E 's/.*overall: (PASS|FAIL).*/\1/' || echo "ERROR")"
  if [[ "$bench_status" -ne 0 ]]; then
    overall="ERROR"
  fi

  echo -e "${label}\t${thinking}\t${exact:-?}\t${wrong:-?}\t${amount:-?}\t${median:-?}\t${worst:-?}\t${tokens:-?}\t${mem}\t${overall}\t${log}" >>"$SUMMARY"

  docker compose --env-file "$COMPOSE_ENV" stop extractor >/dev/null 2>&1 || true
done <"$MODELS_ENV"

echo ""
echo "Results: $RESULTS_DIR"
echo "Paste summary.tsv into ADR 0017 amendment (Model choice)."
