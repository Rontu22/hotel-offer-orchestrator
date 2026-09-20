#!/usr/bin/env bash
# Builds the static bundle and publishes it to S3 behind CloudFront.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/infra/.env.aws"

cd "$ROOT/infra/terraform"
BUCKET=$(terraform output -raw site_bucket)
DIST=$(terraform output -raw cloudfront_distribution_id)

cd "$ROOT/frontend"
# Empty base URL = same origin; CloudFront routes /api to the EC2 origin.
NEXT_PUBLIC_API_BASE_URL="" npm run build

# Hashed assets can be cached forever; the entry HTML must never be.
aws s3 sync out/ "s3://$BUCKET/" --delete \
  --exclude "*.html" --exclude "*.txt" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 sync out/ "s3://$BUCKET/" --delete \
  --exclude "*" --include "*.html" --include "*.txt" \
  --cache-control "no-cache, must-revalidate"

aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output text

echo "Deployed: $(terraform -chdir="$ROOT/infra/terraform" output -raw site_url)"
