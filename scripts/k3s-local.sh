#!/usr/bin/env bash
# The k3s manifests (deploy/k3s) on this machine: a k3s in Docker, with its
# Traefik and network policies, deployed from deploy/k3s-local with the
# settings and secrets of .env. Serves http://localhost:3000 — the address
# Google sign-in already knows — so stop `npm run dev` first.
#
#   scripts/k3s-local.sh up              build the images, start the cluster, deploy
#   scripts/k3s-local.sh status          pods and the ingress
#   scripts/k3s-local.sh logs <name>     follow web, worker, extractor, ocr, postgres or redis
#   scripts/k3s-local.sh kubectl <args>  kubectl against this cluster, never your current context
#   scripts/k3s-local.sh stop            stop the cluster, keep its data
#   scripts/k3s-local.sh down            delete the cluster and its data
#
# The first `up` copies the database of `npm run dev` (the compose Postgres)
# into the cluster, so her companies are there; HUGO_LOCAL_EMPTY=1 starts empty.
# The model is read from ./models, not downloaded. Two copies of it do not fit
# in Docker Desktop's memory, so `up` stops the compose extractor while the
# cluster runs, and `stop`/`down` start it again.
#
# HUGO_LOCAL_PORT (3000), HUGO_LOCAL_API_PORT (16443), HUGO_LOCAL_SKIP_BUILD=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.k3s-local"
CLUSTER=hugo-k3s
K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:v1.34.1-k3s1}"
PORT="${HUGO_LOCAL_PORT:-3000}"
API_PORT="${HUGO_LOCAL_API_PORT:-16443}"
MODEL_FILE=Qwen3-4B-Q4_0.gguf
export KUBECONFIG="$STATE/kubeconfig"

say() { printf '\033[1m[k3s-local]\033[0m %s\n' "$*"; }
die() { say "$*" >&2; exit 1; }
k() { kubectl --kubeconfig "$KUBECONFIG" "$@"; }
compose() { docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.docker" -f "$ROOT/docker-compose.yml" "$@"; }

cluster_exists() { docker container inspect "$CLUSTER" >/dev/null 2>&1; }
cluster_running() { [ "$(docker container inspect -f '{{.State.Running}}' "$CLUSTER" 2>/dev/null)" = "true" ]; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Values exactly as Node reads .env (quotes, escapes), one per call.
env_value() {
  node --env-file="$ROOT/.env" -e 'process.stdout.write(process.env[process.argv[1]] ?? "")' "$1"
}

check_prerequisites() {
  command -v docker >/dev/null || die "docker is needed"
  command -v kubectl >/dev/null || die "kubectl is needed"
  command -v node >/dev/null || die "node is needed"
  [ -f "$ROOT/.env" ] || die ".env is missing (cp .env.example .env)"
  [ -f "$ROOT/.env.docker" ] || die ".env.docker is missing (cp .env.docker.example .env.docker)"
  [ -s "$ROOT/models/$MODEL_FILE" ] || die "models/$MODEL_FILE is missing: npm run benchmark:download-models -- --adopted"
  for key in AUTH_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET GOOGLE_SERVICE_ACCOUNT_JSON ALLOWED_EMAILS DRIVE_PARENT_FOLDER_ID; do
    [ -n "$(env_value "$key")" ] || die "$key is empty in .env"
  done
}

free_memory_for_the_model() {
  if [ -n "$(compose ps --status running -q extractor 2>/dev/null)" ]; then
    say "stopping the compose extractor: two copies of the model do not fit in Docker's memory"
    compose stop extractor >/dev/null 2>&1
    touch "$STATE/compose-extractor-was-running"
  fi
}

give_back_the_model() {
  if [ -f "$STATE/compose-extractor-was-running" ]; then
    say "starting the compose extractor again"
    compose start extractor >/dev/null 2>&1 || true
    rm -f "$STATE/compose-extractor-was-running"
  fi
}

build_images() {
  if [ "${HUGO_LOCAL_SKIP_BUILD:-0}" = "1" ]; then
    say "not building (HUGO_LOCAL_SKIP_BUILD=1)"
    return
  fi
  say "building hugo-app and hugo-ocr"
  docker build -q -t hugo-app "$ROOT" >/dev/null
  docker build -q -t hugo-ocr "$ROOT/services/ocr" >/dev/null
}

start_cluster() {
  if cluster_exists; then
    cluster_running || { say "starting the cluster"; docker start "$CLUSTER" >/dev/null; }
  else
    say "creating the cluster ($K3S_IMAGE)"
    docker run -d --name "$CLUSTER" --privileged --tmpfs /run --tmpfs /var/run \
      -p "127.0.0.1:$PORT:80" -p "127.0.0.1:$API_PORT:6443" \
      -v "$ROOT/models:/models:ro" \
      "$K3S_IMAGE" server --disable metrics-server --tls-san 127.0.0.1 >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec "$CLUSTER" test -s /etc/rancher/k3s/k3s.yaml 2>/dev/null && break
    sleep 2
  done
  docker exec "$CLUSTER" cat /etc/rancher/k3s/k3s.yaml | sed "s#https://127.0.0.1:6443#https://127.0.0.1:$API_PORT#" >"$KUBECONFIG"
  chmod 600 "$KUBECONFIG"
  for _ in $(seq 1 60); do
    k get nodes 2>/dev/null | grep -q " Ready" && break
    sleep 2
  done
  k get nodes | grep -q " Ready" || die "the node did not become ready"
  # k3s installs Traefik from a Helm chart shortly after the node is up.
  for _ in $(seq 1 60); do
    k -n kube-system get deployment traefik >/dev/null 2>&1 && break
    sleep 3
  done
  k -n kube-system rollout status deployment/traefik --timeout=180s >/dev/null
}

import_images() {
  say "importing the images into the cluster"
  docker save hugo-app:latest hugo-ocr:latest | docker exec -i "$CLUSTER" ctr -n k8s.io images import - >/dev/null
}

write_config() {
  cat >"$ROOT/deploy/k3s-local/local.env" <<EOF
AUTH_URL=http://localhost:$PORT
ALLOWED_EMAILS=$(env_value ALLOWED_EMAILS)
DRIVE_PARENT_FOLDER_ID=$(env_value DRIVE_PARENT_FOLDER_ID)
DRIVE_WEBHOOK_URL=
EOF
}

write_secret() {
  local dir="$STATE/secret"
  mkdir -p "$dir"
  chmod 700 "$dir"
  for key in AUTH_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET GOOGLE_SERVICE_ACCOUNT_JSON; do
    (umask 077 && env_value "$key" >"$dir/$key")
  done
  # Postgres keeps the password it was created with: made once, kept with the cluster.
  for key in POSTGRES_PASSWORD REDIS_PASSWORD; do
    [ -s "$dir/$key" ] || (umask 077 && openssl rand -hex 24 | tr -d '\n' >"$dir/$key")
  done
  k apply -f "$ROOT/deploy/k3s/namespace.yaml" >/dev/null
  k -n hugo create secret generic hugo-secrets --from-file="$dir" --dry-run=client -o yaml | k apply -f - >/dev/null
}

deploy_postgres_with_dev_data() {
  k apply -k "$ROOT/deploy/k3s-local" -l app.kubernetes.io/name=postgres >/dev/null
  k -n hugo rollout status statefulset/postgres --timeout=180s >/dev/null
  local empty
  empty=$(k -n hugo exec postgres-0 -- psql -U hugo -d hugo -tAc "SELECT to_regclass('public.companies') IS NULL")
  if [ "$empty" != "t" ]; then
    return
  fi
  if [ "${HUGO_LOCAL_EMPTY:-0}" = "1" ]; then
    say "starting with an empty database (HUGO_LOCAL_EMPTY=1)"
  elif [ -n "$(compose ps --status running -q postgres 2>/dev/null)" ]; then
    say "copying the dev database (compose Postgres) into the cluster"
    compose exec -T postgres pg_dump -U hugo --no-owner --no-privileges hugo |
      k -n hugo exec -i postgres-0 -- psql -q -v ON_ERROR_STOP=1 -U hugo -d hugo >/dev/null
  else
    say "the compose Postgres is not running: starting with an empty database"
  fi
}

cmd_up() {
  check_prerequisites
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  if ! cluster_running && port_in_use "$PORT"; then
    die "localhost:$PORT is taken — stop npm run dev, or the compose proxy (docker compose --profile app stop proxy). Another HUGO_LOCAL_PORT works too, but Google sign-in only knows :3000."
  fi
  free_memory_for_the_model
  build_images
  start_cluster
  import_images
  write_config
  write_secret
  deploy_postgres_with_dev_data
  local existed=0
  k -n hugo get deployment web >/dev/null 2>&1 && existed=1
  say "deploying deploy/k3s-local"
  k apply -k "$ROOT/deploy/k3s-local" >/dev/null
  if [ "$existed" = "1" ]; then
    # Freshly imported images under the same tag reach running pods only on restart.
    k -n hugo rollout restart deployment/web deployment/worker deployment/ocr >/dev/null
  fi
  for workload in deployment/web deployment/worker deployment/ocr deployment/extractor statefulset/redis; do
    k -n hugo rollout status "$workload" --timeout=300s >/dev/null || die "$workload did not become ready: scripts/k3s-local.sh logs ${workload#*/}"
  done
  say "ready: http://localhost:$PORT"
}

cmd_status() {
  k -n hugo get pods,ingress
}

cmd_logs() {
  local name="${1:-web}"
  case "$name" in
    postgres | redis) k -n hugo logs -f "statefulset/$name" ;;
    *) k -n hugo logs -f "deployment/$name" --all-containers ;;
  esac
}

cmd_stop() {
  cluster_exists && docker stop "$CLUSTER" >/dev/null && say "cluster stopped; \`up\` starts it again with its data"
  give_back_the_model
}

cmd_down() {
  cluster_exists && docker rm -f "$CLUSTER" >/dev/null && say "cluster deleted"
  give_back_the_model
  rm -rf "$STATE" "$ROOT/deploy/k3s-local/local.env"
}

case "${1:-}" in
  up) cmd_up ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  kubectl) shift; k "$@" ;;
  stop) cmd_stop ;;
  down) cmd_down ;;
  *) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
