# Sidecar host choice (issue 14 — fill before production)

| Option | RAM | CPU | Notes |
| --- | --- | --- | --- |
| N100 mini PC | 16 GB | x86, 4 cores | Same `docker compose` as Mac; fits 0.5B–1.5B Q4 + OCR if slice 11 memory column OK |
| k3s Ampere node | _cluster spec_ | ARM64 | Needs ARM images for llama.cpp + OCR build; prefer if cluster already has spare CPU |

**Chosen:** _TBD — record date and reason here once Filip picks._

**Network:** App box and sidecar box joined with Tailscale or WireGuard. `EXTRACTOR_URL` and `OCR_URL` use the private IP or MagicDNS name, never a public port.

**Exposure:** Sidecar ports bind `127.0.0.1` on the sidecar host only, or no host publish when app runs on same machine via Docker network.
