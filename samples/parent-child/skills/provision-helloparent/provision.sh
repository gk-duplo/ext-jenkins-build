#!/usr/bin/env bash
set -euo pipefail

# Provisions a HelloParent: read title from shared/hello-parent.json, derive a slug, write it back via
# the resource's OWN REST route. Status and results are two separate APIs.

SPEC_FILE="shared/hello-parent.json"

WORKSPACE_ID=$(jq -r '.ownerWorkspaceId' "$SPEC_FILE")
ID=$(jq -r '.id' "$SPEC_FILE")
TITLE=$(jq -r '.spec.title // ""' "$SPEC_FILE")

BASE="${DUPLO_BASE:-$DUPLO_HOST}"
RES="$BASE/v1/aiservicedesk/user/data/workspaces/$WORKSPACE_ID/environment/extensions/hello-parents/$ID"
auth=(-H "Authorization: Bearer $DUPLO_TOKEN" -H "Content-Type: application/json")

curl -fsS -X POST "$RES/status" "${auth[@]}" -d '{"status":"Processing","subStatus":"Deriving slug"}'

SLUG="$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -s ' ' '-' | sed 's/^-//;s/-$//')"

curl -fsS -X POST "$RES/results" "${auth[@]}" -d "$(jq -nc --arg s "$SLUG" '{slug:$s}')"
curl -fsS -X POST "$RES/status"  "${auth[@]}" -d '{"status":"Complete"}'
