# 14 — Deploy the model and OCR sidecars

Type: HITL
Status: needs-human
User stories: 23

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

Move the sidecars off the laptop. Human in the loop because it means choosing and provisioning a
machine.

Choose between the N100 mini PC with 16 GB and an Ampere (ARM) node on the existing k3s cluster,
using slice 11's memory and timing figures. Run the same `docker compose` services there — or their
k3s equivalent — and, if that box is not the one the app runs on, join the two with a private tunnel
(WireGuard or Tailscale). The app points at them by environment configuration only. Documents must
never cross the public internet unencrypted, and the services must not be reachable from it.

## Acceptance criteria

- [ ] The node is chosen with the reason recorded next to the deployment files
- [ ] The model and OCR services run there with the configuration chosen in slice 11
- [ ] The app reaches them only over a private network, and neither service is exposed publicly
- [ ] The app's endpoints are set by environment configuration, with no code change
- [ ] A smoke test reads one text-layer invoice and one image document end to end on the deployed services
- [ ] Switching the node off leaves documents pending, and switching it back on resumes extraction
- [ ] A short runbook covers starting, updating the model and checking health

## Blocked by

- 11 — Choose the model
- 13 — OCR for image documents
