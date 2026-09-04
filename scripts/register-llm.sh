#!/usr/bin/env bash
# Register the LLM model the agent actually runs on with the studio, and make it the System default.
#
# WHY: the studio ships no LLM model records of its own, so on a fresh dev-kit DB the ticket LLM picker
# has nothing to offer. This registers one model, points it at the local agent, and makes it the *only*
# model in the single System LlmModelMapping so the picker shows exactly the model that will be used.
#
# Provider-agnostic: the id comes from CLAUDE_MODEL in .env, which run.sh sets per provider — a bare id
# (claude-sonnet-4-6) for direct Anthropic, an inference-profile id (us.anthropic.claude-sonnet-4-6) for
# either Bedrock mode. The two are not interchangeable: the direct Anthropic API rejects the us.* prefix
# and Bedrock requires it, so registering the wrong variant yields a picker entry that fails on use.
#
# Usage: ./scripts/register-llm.sh [model-id]
#   model-id defaults to CLAUDE_MODEL in .env (what the agent container actually uses).
#   LLM_PROVIDER_LABEL (env, optional) suffixes the display name, e.g. "AWS Bedrock" →
#   "us.anthropic.claude-sonnet-4-6 (AWS Bedrock)". Defaults to a label inferred from the model id.
set -euo pipefail
cd "$(dirname "$0")/.."

source "$(dirname "$0")/_target.sh"   # → BASE_URL + TOKEN from .env per DUPLO_TARGET
[ -n "$TOKEN" ] || { echo "No token resolved — set DUPLO_ADMIN_TOKEN (local) or DUPLO_TOKEN (remote) in .env." >&2; exit 1; }

# Model id: arg > CLAUDE_MODEL in .env. Bare id for direct Anthropic, us.anthropic.* for Bedrock.
MODEL="${1:-$(grep -E '^CLAUDE_MODEL=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)}"
[ -n "$MODEL" ] || { echo "No model id — pass one as \$1 or set CLAUDE_MODEL in .env." >&2; exit 1; }

# Display-name suffix. run.sh passes the exact provider (it knows which Bedrock mode); standalone runs
# fall back to the shape of the id, which distinguishes Bedrock from direct Anthropic but not which
# Bedrock credential source is in play.
case "$MODEL" in
  us.*|global.*|*.anthropic.*) LABEL="${LLM_PROVIDER_LABEL:-AWS Bedrock}" ;;
  *)                           LABEL="${LLM_PROVIDER_LABEL:-Direct Anthropic}" ;;
esac

# ── resolve the agent id (prefer 'local-agent', else first active agent) ──────────
AGENT_ID=$(curl -fsS --max-time 15 "$BASE_URL/v1/aiservicedesk/admin/data/AIAgents" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c 'import sys,json
d=json.load(sys.stdin); items=d.get("data",{}); items=items.get("items",items) if isinstance(items,dict) else items
items=items or []
a=next((x for x in items if x.get("name")=="local-agent"), None) or next((x for x in items if x.get("isActive",True)), None)
print(a["id"] if a else "")' 2>/dev/null || true)
[ -n "$AGENT_ID" ] || { echo "No agent found — run ./scripts/register-agent.sh first." >&2; exit 1; }
echo "==> Using agent id: $AGENT_ID"

# ── register the LLM model (idempotent by modelId) ────────────────────────────────
MODEL_UUID=$(curl -fsS --max-time 15 "$BASE_URL/v1/aiservicedesk/admin/data/Models?filters%5BmodelId%5D=$MODEL" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | M="$MODEL" python3 -c 'import sys,json,os
d=json.load(sys.stdin); items=d.get("data",{}); items=items.get("items",items) if isinstance(items,dict) else items
print(next((x["id"] for x in (items or []) if x.get("modelId")==os.environ["M"] and x.get("isActive",True)), ""))' 2>/dev/null || true)
if [ -n "$MODEL_UUID" ]; then
  echo "==> LLM model '$MODEL' already registered (id: $MODEL_UUID)"
else
  echo "==> Registering LLM model '$MODEL' → agent $AGENT_ID"
  MODEL_UUID=$(curl -fsS --max-time 15 -X POST "$BASE_URL/v1/aiservicedesk/admin/data/Models" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "$(M="$MODEL" A="$AGENT_ID" L="$LABEL" python3 -c 'import json,os
m=os.environ["M"]; label=os.environ["L"]
print(json.dumps({"modelId":m,"displayName":m+" ("+label+")","agentIds":[os.environ["A"]],"enabled":True,"createdBy":"dev-kit"}))')" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
  echo "    model id: $MODEL_UUID"
fi
[ -n "$MODEL_UUID" ] || { echo "Failed to register/resolve the LLM model." >&2; exit 1; }

# ── make it the System model (idempotent) ─────────────────────────────────────────
# Only one active System mapping may exist. If the seeder already created one (full of broken
# us.anthropic.* entries), PUT it back with ONLY our model. Otherwise create a fresh one.
MAPPING=$(curl -fsS --max-time 15 "$BASE_URL/v1/aiservicedesk/admin/data/ModelMappings?filters%5Bscope%5D=System" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c 'import sys,json
d=json.load(sys.stdin); items=d.get("data",{}); items=items.get("items",items) if isinstance(items,dict) else items
m=next((x for x in (items or []) if x.get("scope")=="System" and x.get("isActive",True)), None)
print(json.dumps(m) if m else "")' 2>/dev/null || true)

if [ -z "$MAPPING" ]; then
  echo "==> Creating System model mapping (default: $MODEL)"
  MAPPING_ID=$(curl -fsS --max-time 15 -X POST "$BASE_URL/v1/aiservicedesk/admin/data/ModelMappings" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "$(U="$MODEL_UUID" A="$AGENT_ID" python3 -c 'import json,os
print(json.dumps({"scope":"System","models":[{"modelId":os.environ["U"],"agentId":os.environ["A"]}],"defaultModelId":os.environ["U"],"createdBy":"dev-kit"}))')" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
  echo "    mapping id: $MAPPING_ID"
else
  # Already configured? (sole model == ours AND it's the default) → no-op.
  if printf '%s' "$MAPPING" | U="$MODEL_UUID" python3 -c 'import sys,json,os
m=json.load(sys.stdin); u=os.environ["U"]
models=m.get("models") or []
sys.exit(0 if (len(models)==1 and models[0].get("modelId")==u and m.get("defaultModelId")==u) else 1)' 2>/dev/null; then
    MAPPING_ID=$(printf '%s' "$MAPPING" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
    echo "==> System model mapping already configured for '$MODEL' (id: $MAPPING_ID) — nothing to do."
  else
    echo "==> Replacing System model mapping with only '$MODEL' (removing existing entries)"
    PAYLOAD=$(printf '%s' "$MAPPING" | U="$MODEL_UUID" A="$AGENT_ID" python3 -c 'import sys,json,os
m=json.load(sys.stdin); u=os.environ["U"]; a=os.environ["A"]
m["models"]=[{"modelId":u,"agentId":a}]
m["defaultModelId"]=u
m["updatedBy"]="dev-kit"
print(json.dumps(m))')
    MAPPING_ID=$(printf '%s' "$PAYLOAD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
    printf '%s' "$PAYLOAD" | curl -fsS --max-time 15 -X PUT "$BASE_URL/v1/aiservicedesk/admin/data/ModelMappings/$MAPPING_ID" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @- >/dev/null
    echo "    updated mapping id: $MAPPING_ID"
  fi
fi

echo "==> Done. System default LLM: '$MODEL' (model $MODEL_UUID, mapping $MAPPING_ID)."
