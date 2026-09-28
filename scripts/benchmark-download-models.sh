#!/usr/bin/env bash
# Downloads the ADR 0017 benchmark candidates into ./models; files already
# present are skipped. `--adopted` fetches only the model in use (~2.4 GB);
# the whole set is ~25 GB.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${EXTRACTOR_MODEL_DIR:-$ROOT/models}"
mkdir -p "$MODEL_DIR"

# repo|file. Qwen publishes no Q4_0 of Qwen3 4B; the adopted one is Unsloth's.
ADOPTED="unsloth/Qwen3-4B-GGUF|Qwen3-4B-Q4_0.gguf"
CANDIDATES=(
  "$ADOPTED"
  "Qwen/Qwen3-0.6B-GGUF|Qwen3-0.6B-Q8_0.gguf"
  "Qwen/Qwen3-1.7B-GGUF|Qwen3-1.7B-Q8_0.gguf"
  "Qwen/Qwen3-4B-GGUF|Qwen3-4B-Q4_K_M.gguf"
  "google/gemma-4-E4B-it-qat-q4_0-gguf|gemma-4-E4B_q4_0-it.gguf"
  "google/gemma-4-E2B-it-qat-q4_0-gguf|gemma-4-E2B_q4_0-it.gguf"
  "unsloth/Qwen3.5-4B-GGUF|Qwen3.5-4B-Q4_K_M.gguf"
  "unsloth/Qwen3.5-2B-GGUF|Qwen3.5-2B-Q4_K_M.gguf"
  "unsloth/Llama-3.2-3B-Instruct-GGUF|Llama-3.2-3B-Instruct-Q4_K_M.gguf"
)
if [[ "${1:-}" == "--adopted" ]]; then
  CANDIDATES=("$ADOPTED")
fi

for candidate in "${CANDIDATES[@]}"; do
  IFS='|' read -r repo file <<<"$candidate"
  target="$MODEL_DIR/$file"
  if [[ -s "$target" ]]; then
    echo "have  $file"
    continue
  fi
  echo "fetch $file from $repo"
  curl -fL --retry 3 --progress-bar -o "$target.part" \
    "https://huggingface.co/$repo/resolve/main/$file"
  mv "$target.part" "$target"
done
