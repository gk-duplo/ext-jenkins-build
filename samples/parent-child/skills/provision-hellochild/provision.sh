#!/usr/bin/env bash
set -euo pipefail

# Provisions a HelloChild: read note + parentId from shared/hello-child.json, compose a message, write it
# back via the child's OWN nested REST route. Status and results are two separate APIs.

SPEC_FILE="shared/hello-child.json"

WORKSPACE_ID=$(jq -r '.ownerWorkspaceId' "$SPEC_FILE")
ID=$(jq -r '.id' "$SPEC_FILE")
PARENT_ID=$(jq -r '.spec.parentId // ""' "$SPEC_FILE")
NOTE=$(jq -r '.spec.note // ""' "$SPEC_FILE")

BASE="${DUPLO_BASE:-$DUPLO_HOST}"
RES="$BASE/v1/aiservicedesk/user/data/workspaces/$WORKSPACE_ID/environment/extensions/hello-parents/$PARENT_ID/hello-children/$ID"
auth=(-H "Authorization: Bearer $DUPLO_TOKEN" -H "Content-Type: application/json")

curl -fsS -X POST "$RES/status" "${auth[@]}" -d '{"status":"Processing","subStatus":"Composing message"}'

MESSAGE="$NOTE"

curl -fsS -X POST "$RES/results" "${auth[@]}" -d "$(jq -nc --arg m "$MESSAGE" '{message:$m}')"
curl -fsS -X POST "$RES/status"  "${auth[@]}" -d '{"status":"Complete"}'
