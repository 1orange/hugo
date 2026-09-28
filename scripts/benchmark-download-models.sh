#!/usr/bin/env bash
# Downloads the ADR 0017 benchmark candidates (official Qwen GGUF files) into ./models.
# ~5 GB in total; files already present are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${EXTRACTOR_MODEL_DIR:-$ROOT/models}"
mkdir -p "$MODEL_DIR"

# repo|file
CANDIDATES=(
  "Qwen/Qwen3-0.6B-GGUF|Qwen3-0.6B-Q8_0.gguf"
  "Qwen/Qwen3-1.7B-GGUF|Qwen3-1.7B-Q8_0.gguf"
  "Qwen/Qwen3-4B-GGUF|Qwen3-4B-Q4_K_M.gguf"
)

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
