#!/usr/bin/env bash
# Runs a local shell script on the EC2 instance through SSM (no SSH key needed)
# and streams back its output.
#   infra/scripts/ssm-exec.sh <script-file> [timeout-polls]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/infra/.env.aws"

INSTANCE="${INSTANCE_ID:-$(cd "$ROOT/infra/terraform" && terraform output -raw instance_id)}"
POLLS="${2:-120}"

python3 -c "import json,sys; print(json.dumps({'commands': open(sys.argv[1]).read().split(chr(10))}))" "$1" > /tmp/ssm-params.json

ID=$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript --comment "hotel-offers deploy" \
  --parameters file:///tmp/ssm-params.json --timeout-seconds 1800 \
  --query 'Command.CommandId' --output text)

for _ in $(seq 1 "$POLLS"); do
  STATUS=$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$ID" \
    --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Success|Failed|TimedOut|Cancelled) break ;; esac
  sleep 5
done

aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$ID" --instance-id "$INSTANCE" \
  --query 'StandardOutputContent' --output text
ERR=$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$ID" --instance-id "$INSTANCE" \
  --query 'StandardErrorContent' --output text)
[ -n "$ERR" ] && [ "$ERR" != "None" ] && echo "[stderr] $ERR" >&2
echo "[status: $STATUS]"
[ "$STATUS" = "Success" ]
