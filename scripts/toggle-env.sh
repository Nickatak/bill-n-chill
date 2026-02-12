#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/toggle-env.sh <local|prod> [--force]

Sets the active .env by copying from .env.local or .env.prod.

Options:
  --force   Overwrite existing .env without backup
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

target="${1}"
force="${2:-}"

if [[ "${target}" != "local" && "${target}" != "prod" ]]; then
  echo "Error: target must be 'local' or 'prod'."
  usage
  exit 1
fi

src=".env.${target}"
dst=".env"

if [[ ! -f "${src}" ]]; then
  echo "Error: ${src} does not exist."
  echo "Create it from .env.example first."
  exit 1
fi

if [[ -f "${dst}" && "${force}" != "--force" ]]; then
  backup=".env.backup.$(date +%Y%m%d%H%M%S)"
  cp "${dst}" "${backup}"
  echo "Backed up existing ${dst} to ${backup}"
fi

cp "${src}" "${dst}"
echo "Active environment set: ${target} (${src} -> ${dst})"
