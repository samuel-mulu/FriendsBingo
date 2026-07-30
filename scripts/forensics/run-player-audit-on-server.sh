#!/usr/bin/env bash
# Copy forensic SQL into the postgres container and run it (read-only).
# Usage (on production host, from FriendsBingo deploy dir):
#   bash scripts/forensics/run-player-audit-on-server.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/player-251914407635-audit.sql"
OUT_FILE="${SCRIPT_DIR}/player-251914407635-audit-results-$(date +%Y%m%d-%H%M%S).txt"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "Missing $SQL_FILE" >&2
  exit 1
fi

echo "Running forensic audit → $OUT_FILE"
docker compose exec -T postgres \
  psql -U gameuser -d gamedb \
  -v ON_ERROR_STOP=0 \
  -f - < "$SQL_FILE" | tee "$OUT_FILE"

echo "Saved: $OUT_FILE"
