#!/usr/bin/env bash
# Called by PostgreSQL's archive_command for each completed WAL segment.
#
# Usage (set in postgresql.conf or via -c flag):
#   archive_command = '/usr/local/bin/archive-wal.sh %p %f'
#
# Arguments:
#   $1 = %p = full path to the WAL file to archive
#   $2 = %f = filename only (e.g., 000000010000000000000001)
#
# Environment:
#   B2_BUCKET_NAME       — required, target bucket
#   B2_KEY_ID            — required, Backblaze application key ID
#   B2_APPLICATION_KEY   — required, Backblaze application key
#
# Behavior:
#   - Compresses the WAL segment with gzip
#   - Uploads to B2 under wal/<filename>.gz
#   - Cleans up the temp file
#   - Returns 0 on success (Postgres advances), non-zero on failure (Postgres retries)

set -euo pipefail

WAL_PATH="$1"
WAL_NAME="$2"

# If B2 isn't configured, succeed silently (dev / unconfigured environments).
if [[ -z "${B2_BUCKET_NAME:-}" || -z "${B2_KEY_ID:-}" || -z "${B2_APPLICATION_KEY:-}" ]]; then
    exit 0
fi

TEMP_DIR="/tmp/wal-archive"
mkdir -p "$TEMP_DIR"
COMPRESSED="${TEMP_DIR}/${WAL_NAME}.gz"

# Compress
gzip -c "$WAL_PATH" > "$COMPRESSED"

# Authorize and upload
b2 authorize-account "$B2_KEY_ID" "$B2_APPLICATION_KEY" > /dev/null 2>&1
b2 upload-file "$B2_BUCKET_NAME" "$COMPRESSED" "wal/${WAL_NAME}.gz"

# Clean up
rm -f "$COMPRESSED"
