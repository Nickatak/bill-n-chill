#!/usr/bin/env bash
# Restore PostgreSQL from a base backup + WAL replay (Point-In-Time Recovery).
#
# Modes:
#   PITR (default):  Restores from a pg_basebackup + replays archived WAL segments.
#   Legacy (--dump): Restores from a pg_dump .sql.gz file (no WAL replay).
#
# Usage:
#   ./scripts/restore-db.sh                                       # latest B2 base backup + all WAL
#   ./scripts/restore-db.sh --target "2026-04-10 15:30:00"        # PITR to specific timestamp
#   ./scripts/restore-db.sh --base backups/base_20260410.tar.gz   # use local base backup
#   ./scripts/restore-db.sh --dump backups/bnc_20260324.sql.gz    # legacy pg_dump restore
#
# Flags:
#   --yes            Skip confirmation prompt
#   --target TIME    Recovery target timestamp (PITR mode only)
#   --base FILE      Use a local base backup instead of downloading from B2
#   --dump FILE      Legacy mode: restore from a pg_dump .sql.gz file
#
# Environment (read from .env):
#   POSTGRES_PASSWORD  — required
#   POSTGRES_DB        — defaults to bill_n_chill
#   POSTGRES_USER      — defaults to bnc
#   B2_BUCKET_NAME     — required for downloading from B2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
RESTORE_DIR="${PROJECT_DIR}/restore_staging"

TARGET_TIME=""
BASE_PATH=""
DUMP_PATH=""
SKIP_CONFIRM=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)  TARGET_TIME="$2"; shift 2 ;;
        --base)    BASE_PATH="$2";   shift 2 ;;
        --dump)    DUMP_PATH="$2";   shift 2 ;;
        --latest)  shift ;;  # default behavior, accepted for clarity
        --yes)     SKIP_CONFIRM=true; shift ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: restore-db.sh [--target TIME] [--base FILE] [--dump FILE] [--yes]"
            exit 1
            ;;
    esac
done

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

_confirm() {
    if [[ "$SKIP_CONFIRM" == true ]]; then return 0; fi
    echo ""
    echo "WARNING: $1"
    read -rp "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]]
}

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
    echo "ERROR: POSTGRES_PASSWORD not found in .env"
    exit 1
fi

# ===========================================================================
# Legacy mode: restore from pg_dump .sql.gz file
# ===========================================================================
if [[ -n "$DUMP_PATH" ]]; then
    if [[ ! -f "$DUMP_PATH" ]]; then
        echo "ERROR: Dump file not found: ${DUMP_PATH}"
        exit 1
    fi

    if ! gunzip -t "$DUMP_PATH" 2>/dev/null; then
        echo "ERROR: Dump file failed gzip integrity check: ${DUMP_PATH}"
        exit 1
    fi

    DUMP_SIZE="$(du -h "$DUMP_PATH" | cut -f1)"
    echo "Legacy restore from pg_dump"
    echo "  File: $(basename "$DUMP_PATH") (${DUMP_SIZE})"
    echo "  Target database: ${POSTGRES_DB}"

    if ! _confirm "This will DROP and recreate the '${POSTGRES_DB}' database."; then
        echo "Aborted."
        exit 0
    fi

    _log "Starting legacy restore..."

    _compose exec -T db psql -U "${POSTGRES_USER}" -d postgres -c "
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();
        DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";
        CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";
    "

    gunzip -c "$DUMP_PATH" \
        | _compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --quiet

    _log "Legacy restore complete: $(basename "$DUMP_PATH") -> ${POSTGRES_DB}"
    exit 0
fi

# ===========================================================================
# PITR mode: base backup + WAL replay
# ===========================================================================

# Clean any previous staging and create fresh directory
rm -rf "$RESTORE_DIR"
mkdir -p "${RESTORE_DIR}/wal"

# ---------------------------------------------------------------------------
# Step 1: Resolve base backup
# ---------------------------------------------------------------------------
if [[ -n "$BASE_PATH" ]]; then
    if [[ ! -f "$BASE_PATH" ]]; then
        echo "ERROR: Base backup not found: ${BASE_PATH}"
        exit 1
    fi
    cp "$BASE_PATH" "${RESTORE_DIR}/base_backup.tar.gz"
    echo "Using local base backup: $(basename "$BASE_PATH")"
else
    if [[ -z "$B2_BUCKET_NAME" ]]; then
        echo "ERROR: B2_BUCKET_NAME not set and no --base file provided"
        exit 1
    fi

    echo "Fetching latest base backup from B2..."
    _compose run --rm --no-deps \
        --entrypoint bash \
        -v "${RESTORE_DIR}:/restore" \
        db -c '
            LATEST=$(b2 ls "b2://${B2_BUCKET_NAME}/base/" | sort | tail -1)
            if [ -z "$LATEST" ]; then
                echo "ERROR: No base backups found in B2 bucket"
                exit 1
            fi
            echo "Downloading: $LATEST"
            b2 file download "b2://${B2_BUCKET_NAME}/${LATEST}" /restore/base_backup.tar.gz
        '
    if [[ ! -f "${RESTORE_DIR}/base_backup.tar.gz" ]]; then
        echo "ERROR: Base backup download failed"
        rm -rf "$RESTORE_DIR"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Step 2: Download WAL files from B2
# ---------------------------------------------------------------------------
WAL_COUNT=0

if [[ -n "$B2_BUCKET_NAME" ]]; then
    echo "Downloading WAL segments from B2..."
    _compose run --rm --no-deps \
        --entrypoint bash \
        -v "${RESTORE_DIR}:/restore" \
        db -c '
            for f in $(b2 ls "b2://${B2_BUCKET_NAME}/wal/"); do
                b2 file download "b2://${B2_BUCKET_NAME}/${f}" "/restore/wal/$(basename "$f")"
            done
        '
    WAL_COUNT=$(find "${RESTORE_DIR}/wal" -type f 2>/dev/null | wc -l)
    echo "Downloaded ${WAL_COUNT} WAL segment(s)"
else
    echo "WARNING: B2_BUCKET_NAME not set, skipping WAL download."
    echo "         Recovery will use only WAL present in the base backup."
fi

# ---------------------------------------------------------------------------
# Step 3: Confirmation
# ---------------------------------------------------------------------------
BASE_SIZE="$(du -h "${RESTORE_DIR}/base_backup.tar.gz" | cut -f1)"

echo ""
echo "PITR Recovery Plan:"
echo "  Base backup: $(basename "${BASE_PATH:-B2 latest}") (${BASE_SIZE})"
echo "  WAL segments: ${WAL_COUNT}"
if [[ -n "$TARGET_TIME" ]]; then
    echo "  Target time: ${TARGET_TIME}"
else
    echo "  Target: latest (replay all available WAL)"
fi

if ! _confirm "This will REPLACE the entire PostgreSQL data directory. The current database will be destroyed."; then
    echo "Aborted."
    rm -rf "$RESTORE_DIR"
    exit 0
fi

# ---------------------------------------------------------------------------
# Step 4: Write recovery configuration to staging
# ---------------------------------------------------------------------------
cat > "${RESTORE_DIR}/recovery.conf" <<EOF
restore_command = 'gunzip -c /var/lib/postgresql/data/pg_wal_restore/%f.gz > %p'
EOF

if [[ -n "$TARGET_TIME" ]]; then
    echo "recovery_target_time = '${TARGET_TIME}'" >> "${RESTORE_DIR}/recovery.conf"
fi

# ---------------------------------------------------------------------------
# Step 5: Stop the database
# ---------------------------------------------------------------------------
_log "Stopping database..."
_compose stop db

# ---------------------------------------------------------------------------
# Step 6: Replace data directory and configure recovery
# ---------------------------------------------------------------------------
_log "Replacing data directory and configuring recovery..."

_compose run --rm --no-deps \
    --entrypoint bash \
    -v "${RESTORE_DIR}:/restore:ro" \
    db -c '
        # Clear existing data directory
        rm -rf /var/lib/postgresql/data/*

        # Extract base backup
        tar xzf /restore/base_backup.tar.gz -C /var/lib/postgresql/data/

        # Stage WAL files inside the data volume so they persist after this
        # container exits. Postgres reads them via restore_command.
        mkdir -p /var/lib/postgresql/data/pg_wal_restore
        cp /restore/wal/*.gz /var/lib/postgresql/data/pg_wal_restore/ 2>/dev/null || true

        # Append recovery settings to the existing postgresql.auto.conf
        cat /restore/recovery.conf >> /var/lib/postgresql/data/postgresql.auto.conf

        # Signal Postgres to enter recovery mode on next start
        touch /var/lib/postgresql/data/recovery.signal

        # Fix ownership and permissions (required by Postgres)
        chown -R postgres:postgres /var/lib/postgresql/data/
        chmod 700 /var/lib/postgresql/data/
    '

# ---------------------------------------------------------------------------
# Step 7: Start database - Postgres detects recovery.signal and replays WAL
# ---------------------------------------------------------------------------
_log "Starting database (recovery mode)..."
_compose up -d db

echo "Waiting for recovery to complete..."
READY=false
for _ in $(seq 1 90); do
    if _compose exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; then
        READY=true
        break
    fi
    sleep 2
done

if [[ "$READY" == true ]]; then
    _log "Recovery complete - database is accepting connections"

    # Clean up: remove WAL staging from the data volume
    _compose exec -T db rm -rf /var/lib/postgresql/data/pg_wal_restore

    # Clean up: remove stale recovery settings from postgresql.auto.conf
    _compose exec -T db sed -i '/^restore_command/d' /var/lib/postgresql/data/postgresql.auto.conf
    _compose exec -T db sed -i '/^recovery_target_time/d' /var/lib/postgresql/data/postgresql.auto.conf

    _log "Cleaned up recovery artifacts"
else
    _log "WARNING: Database not ready after 180 seconds."
    _log "Check logs: docker compose logs db"
    _log "The pg_wal_restore directory was left in place for debugging."
fi

# ---------------------------------------------------------------------------
# Step 8: Clean up local staging
# ---------------------------------------------------------------------------
rm -rf "$RESTORE_DIR"
_log "Restore finished"
