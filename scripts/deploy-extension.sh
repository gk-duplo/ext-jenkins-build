#!/usr/bin/env bash
# Hot-load a built extension.zip into the running platform (no restart).
# Usage: ./scripts/deploy-extension.sh <extension-dir>/dist/extension.zip   # e.g. extension/dist/extension.zip
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP="${1:?usage: deploy-extension.sh <extension.zip>}"
[ -f "$ZIP" ] || { echo "No such file: $ZIP" >&2; exit 1; }

source "$(dirname "$0")/_target.sh"   # → BASE_URL + TOKEN from .env / env per DUPLO_TARGET
BASE_URL="${BASE_URL%/}"               # tolerate a trailing slash in DUPLO_HOST
[ -n "$TOKEN" ] || { echo "No token resolved — set DUPLO_ADMIN_TOKEN (local) or DUPLO_TOKEN (remote)." >&2; exit 1; }

# Warn on a SAME-VERSION redeploy: the studio only best-effort-unloads the old AssemblyLoadContext, so re-loading
# the same manifest.version can keep running the previous backend DLL. Best-effort + non-blocking (needs unzip+jq).
if command -v unzip >/dev/null && command -v jq >/dev/null; then
  _meta=$(unzip -p "$ZIP" manifest.json 2>/dev/null || true)
  _id=$(printf '%s' "$_meta" | jq -r '.id // empty' 2>/dev/null || true)
  _ver=$(printf '%s' "$_meta" | jq -r '.version // empty' 2>/dev/null || true)
  if [ -n "$_id" ] && [ -n "$_ver" ]; then
    _loaded=$(curl -sSL -m 20 "$BASE_URL/v1/aiservicedesk/admin/extensions" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
      | jq -r --arg id "$_id" --arg v "$_ver" '(.data? // .)[]? | select((.extensionId==$id) and (.version==$v)) | .version' 2>/dev/null || true)
    if [ -n "$_loaded" ]; then
      echo "WARNING: '$_id' v$_ver is already loaded. A same-version reload may run STALE backend code" >&2
      echo "         (best-effort ALC unload). Bump manifest.version on backend changes to guarantee fresh code." >&2
    fi
  fi
fi

echo "==> Loading $ZIP ($(du -h "$ZIP" | cut -f1)) → $BASE_URL"
RESP_FILE=$(mktemp)
HTTP=$(curl -sSL -m 180 -o "$RESP_FILE" -w '%{http_code}' -X POST \
  "$BASE_URL/v1/aiservicedesk/admin/extensions/load-bundle" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary @"$ZIP" || echo 000)
BODY=$(tr -d '\r' < "$RESP_FILE"); rm -f "$RESP_FILE"
if [ "$HTTP" -ge 200 ] && [ "$HTTP" -lt 300 ]; then
  echo "==> Loaded (HTTP $HTTP)$(printf '%s' "$BODY" | jq -r '" — " + (.data.extensionId // .extensionId // "")' 2>/dev/null)."
  echo "    Refresh the UI — the new resource type should appear in the left nav."
else
  echo "ERROR: load-bundle failed (HTTP $HTTP) at $BASE_URL/v1/aiservicedesk/admin/extensions/load-bundle" >&2
  echo "       Response: $(printf '%s' "$BODY" | head -c 300)" >&2
  if [ "$HTTP" = 413 ]; then
    echo "       413 = the bundle is larger than the proxy in front of DUPLO_HOST allows. Raise the request body" >&2
    echo "       limit on that ingress (e.g. nginx 'client_max_body_size 1g;') — the studio itself accepts 1GB." >&2
  fi
  exit 1
fi
