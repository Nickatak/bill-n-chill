#!/usr/bin/env bash
# Nightly PostgreSQL backup with optional Backblaze B2 upload.
#
# Usage:
#   ./scripts/backup-db.sh              # dump + upload (if B2 configured)
#   ./scripts/backup-db.sh --local-only # dump only, skip upload
#
# Cron (nightly at 3 AM):
#   0 3 * * * cd /home/deploy/bill-n-chill && ./scripts/backup-db.sh >> logs/backup.log 2>&1
#
# Environment (read from .env in the project root):
#   POSTGRES_PASSWORD  — required
#   POSTGRES_DB        — defaults to bill_n_chill
#   POSTGRES_USER      — defaults to bnc

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
RETENTION_DAYS=30
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

LOCAL_ONLY=false
[[ "${1:-}" == "--local-only" ]] && LOCAL_ONLY=true

# ---------------------------------------------------------------------------
# Read .env
# ---------------------------------------------------------------------------
_env_val() {
    local val
    val="$(grep "^${1}=" "${PROJECT_DIR}/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
    # Strip surrounding quotes if present
    val="${val%\"}" ; val="${val#\"}"
    val="${val%\'}" ; val="${val#\'}"
    echo "$val"
}

POSTGRES_PASSWORD="$(_env_val POSTGRES_PASSWORD)"
POSTGRES_DB="$(_env_val POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-bill_n_chill}"
POSTGRES_USER="$(_env_val POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-bnc}"
B2_BUCKET_NAME="$(_env_val B2_BUCKET_NAME)"

if [[ -z "$POSTGRES_PASSWORD" ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: POSTGRES_PASSWORD not found in .env"
    exit 1
fi

# ---------------------------------------------------------------------------
# Dump
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="bnc_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting backup: ${POSTGRES_DB} → ${BACKUP_FILE}"

docker compose -f "${PROJECT_DIR}/docker-compose.yml" -f "${PROJECT_DIR}/docker-compose.prod.yml" \
    exec -T db pg_dump \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --no-owner \
    --no-acl \
    | gzip > "$BACKUP_PATH"

DUMP_SIZE="$(du -h "$BACKUP_PATH" | cut -f1)"
DUMP_BYTES="$(stat --format=%s "$BACKUP_PATH" 2>/dev/null || stat -f%z "$BACKUP_PATH")"
echo "$(date '+%Y-%m-%d %H:%M:%S') Dump complete: ${BACKUP_FILE} (${DUMP_SIZE})"

# ---------------------------------------------------------------------------
# Integrity checks
# ---------------------------------------------------------------------------
if [[ "$DUMP_BYTES" -lt 1024 ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: Backup file suspiciously small (${DUMP_BYTES} bytes). Aborting."
    rm -f "$BACKUP_PATH"
    exit 1
fi

if ! gunzip -t "$BACKUP_PATH" 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: Backup file failed gzip integrity check. Aborting."
    rm -f "$BACKUP_PATH"
    exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Integrity checks passed (${DUMP_BYTES} bytes, gzip OK)"

# ---------------------------------------------------------------------------
# Upload to Backblaze B2
# ---------------------------------------------------------------------------
if [[ "$LOCAL_ONLY" == false && -n "$B2_BUCKET_NAME" ]]; then
    if command -v b2 &>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Uploading to B2 bucket: ${B2_BUCKET_NAME}"
        b2 upload-file "$B2_BUCKET_NAME" "$BACKUP_PATH" "db/${BACKUP_FILE}"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Upload complete"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') WARNING: b2 CLI not found, skipping upload"
    fi
elif [[ "$LOCAL_ONLY" == false && -z "$B2_BUCKET_NAME" ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') B2_BUCKET_NAME not set, skipping upload (local-only)"
fi

# ---------------------------------------------------------------------------
# Retention: delete local dumps older than N days
# ---------------------------------------------------------------------------
DELETED=$(find "$BACKUP_DIR" -name "bnc_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [[ "$DELETED" -gt 0 ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Backup finished"
