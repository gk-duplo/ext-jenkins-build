#!/usr/bin/env bash
# Hot-load every built extension bundle in this repo (one per extensions/<name>/dist/extension.zip) onto the
# platform. Run after build-all.sh. Each extension is loaded independently; a failed load fails the run.
#
# Usage: ./scripts/deploy-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
shopt -s nullglob

zips=(extensions/*/dist/extension.zip extension/*/dist/extension.zip extension/dist/extension.zip)
count=0
for z in "${zips[@]}"; do
  [ -f "$z" ] || continue
  count=$((count + 1))
  echo "==================== deploy: $z ===================="
  ./scripts/deploy-extension.sh "$z"
done
[ "$count" -gt 0 ] || { echo "No built bundles found — run ./scripts/build-all.sh first." >&2; exit 1; }
echo "==> Hot-loaded $count extension bundle(s)."
