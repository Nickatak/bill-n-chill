#!/usr/bin/env bash
# Nightly PostgreSQL base backup with media backup and Backblaze B2 upload.
#
# Creates a pg_basebackup (physical, WAL-position-aware) base backup.
# Combined with continuous WAL archival (db/archive-wal.sh), this enables
# point-in-time recovery (PITR) via restore-db.sh.
#
# Usage:
#   ./scripts/backup-db.sh              # base backup + media + upload (if B2 configured)
#   ./scripts/backup-db.sh --local-only # backup only, skip upload
#
# Cron (nightly at 3 AM):
#   0 3 * * * cd /home/deploy/bill-n-chill && ./scripts/backup-db.sh >> logs/backup.log 2>&1
#
# Environment (read from .env in the project root):
#   POSTGRES_PASSWORD  — required
#   POSTGRES_DB        — defaults to bill_n_chill
#   POSTGRES_USER      — defaults to bnc
#   B2_BUCKET_NAME     — required for B2 upload

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
RETENTION_DAYS=30
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

LOCAL_ONLY=false
[[ "${1:-}" == "--local-only" ]] && LOCAL_ONLY=true

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_env_val() {
    local val
    val="$(grep "^${1}=" "${PROJECT_DIR}/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
    val="${val%\"}" ; val="${val#\"}"
    val="${val%\'}" ; val="${val#\'}"
    echo "$val"
}

_compose() {
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" -f "${PROJECT_DIR}/docker-compose.prod.yml" "$@"
}

_log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ---------------------------------------------------------------------------
# Read .env
# ---------------------------------------------------------------------------
POSTGRES_PASSWORD="$(_env_val POSTGRES_PASSWORD)"
POSTGRES_DB="$(_env_val POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-bill_n_chill}"
POSTGRES_USER="$(_env_val POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-bnc}"
B2_BUCKET_NAME="$(_env_val B2_BUCKET_NAME)"

if [[ -z "$POSTGRES_PASSWORD" ]]; then
    _log "ERROR: POSTGRES_PASSWORD not found in .env"
    exit 1
fi

# ---------------------------------------------------------------------------
# Base backup (pg_basebackup)
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="base_${TIMESTAMP}.tar.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

_log "Starting base backup: ${POSTGRES_DB} → ${BACKUP_FILE}"

_compose exec -T db pg_basebackup \
    -U "${POSTGRES_USER}" \
    -D - -Ft -z \
    --wal-method=none \
    --label="bnc_${TIMESTAMP}" \
    > "$BACKUP_PATH"

BACKUP_SIZE="$(du -h "$BACKUP_PATH" | cut -f1)"
BACKUP_BYTES="$(stat --format=%s "$BACKUP_PATH" 2>/dev/null || stat -f%z "$BACKUP_PATH")"
_log "Base backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# ---------------------------------------------------------------------------
# Integrity checks
# ---------------------------------------------------------------------------
if [[ "$BACKUP_BYTES" -lt 1024 ]]; then
    _log "ERROR: Backup file suspiciously small (${BACKUP_BYTES} bytes). Aborting."
    rm -f "$BACKUP_PATH"
    exit 1
fi

if ! gunzip -t "$BACKUP_PATH" 2>/dev/null; then
    _log "ERROR: Backup file failed gzip integrity check. Aborting."
    rm -f "$BACKUP_PATH"
    exit 1
fi

_log "Integrity checks passed (${BACKUP_BYTES} bytes, gzip OK)"

# ---------------------------------------------------------------------------
# Media backup (logos, contract PDFs, etc.)
# ---------------------------------------------------------------------------
MEDIA_DIR="${PROJECT_DIR}/media"
MEDIA_PATH=""

if [[ -d "$MEDIA_DIR" ]] && [[ -n "$(ls -A "$MEDIA_DIR" 2>/dev/null)" ]]; then
    MEDIA_FILE="media_${TIMESTAMP}.tar.gz"
    MEDIA_PATH="${BACKUP_DIR}/${MEDIA_FILE}"
    _log "Backing up media directory..."
    tar czf "$MEDIA_PATH" -C "$PROJECT_DIR" media/
    MEDIA_SIZE="$(du -h "$MEDIA_PATH" | cut -f1)"
    _log "Media backup complete: ${MEDIA_FILE} (${MEDIA_SIZE})"
else
    _log "No media files to back up, skipping"
fi

# ---------------------------------------------------------------------------
# Upload to Backblaze B2
# ---------------------------------------------------------------------------
if [[ "$LOCAL_ONLY" == false && -n "$B2_BUCKET_NAME" ]]; then
    _log "Uploading base backup to B2: ${B2_BUCKET_NAME}"
    _compose run --rm --no-deps \
        --entrypoint bash \
        -v "${BACKUP_DIR}:/backups:ro" \
        db -c "b2 upload-file \$B2_BUCKET_NAME /backups/${BACKUP_FILE} base/${BACKUP_FILE}"
    _log "Base backup upload complete"

    if [[ -n "$MEDIA_PATH" ]]; then
        _log "Uploading media backup to B2"
        _compose run --rm --no-deps \
            --entrypoint bash \
            -v "${BACKUP_DIR}:/backups:ro" \
            db -c "b2 upload-file \$B2_BUCKET_NAME /backups/${MEDIA_FILE} media/${MEDIA_FILE}"
        _log "Media upload complete"
    fi
elif [[ "$LOCAL_ONLY" == false && -z "$B2_BUCKET_NAME" ]]; then
    _log "B2_BUCKET_NAME not set, skipping upload (local-only)"
fi

# ---------------------------------------------------------------------------
# Retention: delete local backups older than N days
# ---------------------------------------------------------------------------
DELETED=0
for pattern in "base_*.tar.gz" "media_*.tar.gz" "bnc_*.sql.gz"; do
    COUNT=$(find "$BACKUP_DIR" -name "$pattern" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
    DELETED=$((DELETED + COUNT))
done
if [[ "$DELETED" -gt 0 ]]; then
    _log "Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

_log "Backup finished"
