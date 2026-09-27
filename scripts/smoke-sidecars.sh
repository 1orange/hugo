#!/usr/bin/env bash
# Health check for deployed extractor + OCR sidecars (issue 14).
set -euo pipefail

EXTRACTOR_BASE="${EXTRACTOR_URL:-http://127.0.0.1:8080/v1}"
OCR_BASE="${OCR_URL:-http://127.0.0.1:8090}"
# llama.cpp server health is on the origin, not under /v1
EXTRACTOR_ORIGIN="${EXTRACTOR_BASE%/v1}"

echo "OCR ${OCR_BASE}/health"
curl -sf "${OCR_BASE}/health" | grep -q ok

echo "Extractor ${EXTRACTOR_ORIGIN}/health"
curl -sf "${EXTRACTOR_ORIGIN}/health" >/dev/null || curl -sf "${EXTRACTOR_ORIGIN}/" >/dev/null

echo "smoke:sidecars OK"
