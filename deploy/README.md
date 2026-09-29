# Deployment

The app runs as stateless processes around Postgres and Redis (ADR 0021): any number of **web**
replicas behind a load balancer, one or more **workers** that read documents and sweep Drive,
and the model and OCR sidecars the workers call (ADR 0017). One image serves both roles.

| Process | Command | `HUGO_ROLE` | Probe |
|---|---|---|---|
| web | `node node_modules/next/dist/bin/next start -p 3000` | `web` | `GET /api/health` on 3000 |
| worker | `node dist/worker.mjs` | `worker` | `GET /healthz` on `WORKER_HEALTH_PORT` (9464) |

Every process migrates the database on start; an advisory lock makes that happen once.

## Everything locally, as in production

```bash
cp .env.docker.example .env.docker          # ports, Postgres credentials, model file
docker compose --env-file .env.docker --profile app up -d --build
```

This starts Postgres, Redis, two web replicas (host ports `WEB_PORT_RANGE`, 3000–3001), one
worker, the llama.cpp model server and the OCR sidecar. The app containers read secrets (Auth.js,
Google) from `.env`; the service URLs in `docker-compose.yml` take precedence.

For development, run only the infrastructure and the app on the host:

```bash
docker compose --env-file .env.docker up -d postgres redis extractor ocr
npm run dev          # web and worker in one process (HUGO_ROLE=all)
```

Or split them as production does: `HUGO_ROLE=web npm run dev` and `npm run worker:dev`.

Data from the SQLite version (ADR 0004) is copied once, ids kept:

```bash
npm run db:import-sqlite -- ./dev.db        # add --replace to overwrite a non-empty database
```

## k3s

`deploy/k3s/` is the namespace in plain YAML, applied with kustomize (built into `kubectl`):

| File | What |
|---|---|
| `namespace.yaml`, `config.yaml` | Namespace `hugo`; the `hugo-config` ConfigMap (public URL, allowed emails, Drive folder, sidecar URLs, `EXTRACTOR_CONCURRENCY`) |
| `secret.example.yaml` | Template of the `hugo-secrets` Secret — **not applied**; create the real one by hand |
| `postgres.yaml`, `redis.yaml` | StatefulSets on local-path volumes. Redis append-only, `noeviction`, password from the Secret |
| `web.yaml` | 2 replicas, rolling update, PodDisruptionBudget, spread across nodes |
| `worker.yaml` | 1 replica, 660 s to finish a document on shutdown |
| `extractor.yaml`, `ocr.yaml` | The model server (downloads its model into a volume on first start) and OCR |
| `ingress.yaml` | Traefik `websecure`, TLS from `hugo-tls` |
| `network-policies.yaml` | Postgres and Redis only from the app; model and OCR only from workers; web only from Traefik |

1. Build the images, and push them to your registry or import them into each node's containerd:

   ```bash
   docker build -t hugo-app .
   docker build -t hugo-ocr services/ocr
   docker save hugo-app hugo-ocr | sudo k3s ctr images import -   # or push, and set `images:` in kustomization.yaml
   ```

2. Edit `config.yaml`: `AUTH_URL`, `ALLOWED_EMAILS`, `DRIVE_PARENT_FOLDER_ID`, `DRIVE_WEBHOOK_URL`; and the
   host in `ingress.yaml`. Add `cert-manager.io/cluster-issuer` to the ingress if cert-manager issues
   `hugo-tls`.

3. Create the namespace and the Secret (the command is in `secret.example.yaml`), then apply:

   ```bash
   kubectl apply -f deploy/k3s/namespace.yaml
   kubectl -n hugo create secret generic hugo-secrets ...
   kubectl apply -k deploy/k3s
   ```

What the manifests rely on:

- **Start order does not matter.** Every pod starts at once; web and workers wait up to a minute
  for Postgres, then migrate once under an advisory lock.
- **Probes.** Web readiness is `/api/health` (Postgres and Redis); liveness only checks the port,
  so a database outage takes pods out of the Service without restarting them. Workers: `/healthz`.
- **Shutdown.** A worker finishes the document it is reading (up to the model's ten-minute
  deadline) and exits at once when idle; Postgres stops with a fast shutdown, not after the grace
  period.
- **Scaling.** `kubectl -n hugo scale deploy/web --replicas=N` at will. More workers add
  resilience, not speed: the model's slots are the limit, `-np` in `extractor.yaml` and
  `EXTRACTOR_CONCURRENCY` in `config.yaml` — change both together.
- **Traefik and the event stream.** `/api/events` is server-sent events: no compress middleware on
  this router. Traefik writes an event-stream response through as it arrives, and the app's 20 s
  keep-alive stays inside its idle timeout.
- **Backups.** Postgres lives on one node's local-path volume: back it up (`kubectl -n hugo exec
  postgres-0 -- pg_dump -U hugo hugo > hugo.sql`). Redis holds only what can be rebuilt: a lost
  queue is refilled by the next sweep.

## Single VPS with Caddy

`hugo.service` and `Caddyfile` are the single-machine setup of ADR 0004. They still work for one
web process with `HUGO_ROLE=all`, pointed at a Postgres and a Redis. Caddy must not compress the
event stream; `Caddyfile` leaves `/api/events` uncompressed and flushes it as it comes.

## Verify

```bash
curl -fsS https://hugo.example.eu/api/health      # {"database":true,"redis":true}
```

Unauthenticated requests to `/companies` must receive a redirect to sign-in, not a client-only
hide. The queue page (`/queue`) says "Žiadny worker nebeží" when no worker has reported in the
last half minute.
