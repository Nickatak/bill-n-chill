#!/usr/bin/env bash
# Restore a PostgreSQL backup from a .sql.gz dump file.
#
# Usage:
#   ./scripts/restore-db.sh backups/bnc_20260324_030000.sql.gz
#   ./scripts/restore-db.sh --latest                           # restore most recent dump
#
# Safety:
#   - Prompts for confirmation before overwriting the database.
#   - Pass --yes to skip the prompt (e.g., in scripts).
#
# Environment (read from .env in the project root):
#   POSTGRES_PASSWORD  — required
#   POSTGRES_DB        — defaults to bill_n_chill
#   POSTGRES_USER      — defaults to bnc

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"

SKIP_CONFIRM=false
BACKUP_PATH=""

for arg in "$@"; do
    case "$arg" in
        --yes) SKIP_CONFIRM=true ;;
        --latest) BACKUP_PATH="latest" ;;
        *) BACKUP_PATH="$arg" ;;
    esac
done

# ---------------------------------------------------------------------------
# Read .env
# ---------------------------------------------------------------------------
_env_val() {
    local val
    val="$(grep "^${1}=" "${PROJECT_DIR}/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
    val="${val%\"}" ; val="${val#\"}"
    val="${val%\'}" ; val="${val#\'}"
    echo "$val"
}

POSTGRES_PASSWORD="$(_env_val POSTGRES_PASSWORD)"
POSTGRES_DB="$(_env_val POSTGRES_DB)"
POSTGRES_DB="${POSTGRES_DB:-bill_n_chill}"
POSTGRES_USER="$(_env_val POSTGRES_USER)"
POSTGRES_USER="${POSTGRES_USER:-bnc}"

if [[ -z "$POSTGRES_PASSWORD" ]]; then
    echo "ERROR: POSTGRES_PASSWORD not found in .env"
    exit 1
fi

# ---------------------------------------------------------------------------
# Resolve backup file
# ---------------------------------------------------------------------------
if [[ -z "$BACKUP_PATH" ]]; then
    echo "Usage: restore-db.sh <backup-file.sql.gz | --latest> [--yes]"
    exit 1
fi

if [[ "$BACKUP_PATH" == "latest" ]]; then
    BACKUP_PATH="$(ls -t "${BACKUP_DIR}"/bnc_*.sql.gz 2>/dev/null | head -1)"
    if [[ -z "$BACKUP_PATH" ]]; then
        echo "ERROR: No backup files found in ${BACKUP_DIR}"
        exit 1
    fi
    echo "Latest backup: $(basename "$BACKUP_PATH")"
fi

if [[ ! -f "$BACKUP_PATH" ]]; then
    echo "ERROR: Backup file not found: ${BACKUP_PATH}"
    exit 1
fi

# ---------------------------------------------------------------------------
# Integrity check
# ---------------------------------------------------------------------------
if ! gunzip -t "$BACKUP_PATH" 2>/dev/null; then
    echo "ERROR: Backup file failed gzip integrity check: ${BACKUP_PATH}"
    exit 1
fi

DUMP_SIZE="$(du -h "$BACKUP_PATH" | cut -f1)"
echo "Backup file: $(basename "$BACKUP_PATH") (${DUMP_SIZE})"
echo "Target database: ${POSTGRES_DB}"

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
if [[ "$SKIP_CONFIRM" == false ]]; then
    echo ""
    echo "WARNING: This will DROP and recreate the '${POSTGRES_DB}' database."
    echo "         All existing data will be replaced with the backup contents."
    read -rp "Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting restore..."

# Terminate existing connections and recreate the database
docker compose -f "${PROJECT_DIR}/docker-compose.yml" -f "${PROJECT_DIR}/docker-compose.prod.yml" \
    exec -T db psql -U "${POSTGRES_USER}" -d postgres -c "
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();
        DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";
        CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";
    "

gunzip -c "$BACKUP_PATH" \
    | docker compose -f "${PROJECT_DIR}/docker-compose.yml" -f "${PROJECT_DIR}/docker-compose.prod.yml" \
        exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --quiet

echo "$(date '+%Y-%m-%d %H:%M:%S') Restore complete: $(basename "$BACKUP_PATH") → ${POSTGRES_DB}"
