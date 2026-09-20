#!/usr/bin/env bash
# Cross-builds the backend and the supplier services for the instance's
# architecture, pushes both to ECR, ships the compose file and restarts the
# stack there. Nothing is built on the 1 GB box. Two tags in one repository, so
# no extra ECR repo is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/infra/.env.aws"

ECR=$(terraform -chdir="$ROOT/infra/terraform" output -raw ecr_repository_url)
REGISTRY="${ECR%%/*}"
API_PORT=$(terraform -chdir="$ROOT/infra/terraform" output -raw api_origin | sed 's/.*://')
# The Temporal UI serves its own API from whatever host the browser used.
UI_ORIGIN="http://$(terraform -chdir="$ROOT/infra/terraform" output -raw api_origin | sed 's/:.*//'):8080"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build --platform linux/amd64 -f "$ROOT/infra/docker/backend.Dockerfile"  -t "$ECR:latest"    --push "$ROOT"
docker buildx build --platform linux/amd64 -f "$ROOT/infra/docker/supplier.Dockerfile" -t "$ECR:suppliers" --push "$ROOT"

# The compose file lives in this repo, not on the box: shipping it every deploy
# is what stops the instance drifting from what is committed here.
COMPOSE_B64=$(base64 < "$ROOT/infra/docker-compose.prod.yml" | tr -d '\n')

cat > /tmp/restart.sh <<EOF
set -e
install -d -m 0755 /opt/hotel-offers
cd /opt/hotel-offers

# Keep one rollback copy before overwriting a working stack definition.
[ -f docker-compose.yml ] && cp docker-compose.yml docker-compose.yml.bak
echo "$COMPOSE_B64" | base64 -d > docker-compose.yml

# First deploy onto a fresh box: mint a database password that never leaves it.
# Later deploys keep whatever is already there, so Postgres keeps its data.
if [ ! -f .env ]; then
  umask 077
  {
    echo "POSTGRES_PASSWORD=\$(openssl rand -hex 16)"
    echo "API_PORT=$API_PORT"
    echo "CACHE_TTL_SECONDS=300"
    echo "SUPPLIER_LATENCY_MS=150"
    echo "ENABLE_FAULT_INJECTION=true"
    echo "HEALTH_PROBE_TIMEOUT_MS=6000"
  } > .env
fi

# Both image tags come from the one repository this deploy just pushed to.
grep -q '^BACKEND_IMAGE='  .env || echo "BACKEND_IMAGE=$ECR:latest"     >> .env
grep -q '^SUPPLIER_IMAGE=' .env || echo "SUPPLIER_IMAGE=$ECR:suppliers" >> .env
sed -i "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=$ECR:latest|"      .env
sed -i "s|^SUPPLIER_IMAGE=.*|SUPPLIER_IMAGE=$ECR:suppliers|" .env

grep -q '^TEMPORAL_UI_ORIGIN=' .env || echo "TEMPORAL_UI_ORIGIN=$UI_ORIGIN" >> .env
sed -i "s|^TEMPORAL_UI_ORIGIN=.*|TEMPORAL_UI_ORIGIN=$UI_ORIGIN|" .env

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REGISTRY
docker compose pull -q api worker supplier-a supplier-b
docker compose up -d --remove-orphans
docker compose ps --format "table {{.Service}}\t{{.Status}}"
EOF

"$ROOT/infra/scripts/ssm-exec.sh" /tmp/restart.sh 180
