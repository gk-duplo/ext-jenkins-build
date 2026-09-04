#!/usr/bin/env bash
# tf-run.sh <plan|apply|destroy> [<actionName>]
#
# Runs ONE terraform action for the network stack — the dev-kit's reference for LONG-RUNNING
# provisioning: terraform is launched DETACHED in the background and this script (the agent stays
# attached to it) WATCHES it with a sleep loop, posting progressive Result.modules[] transitions and
# subStatus heartbeats while it runs. Every run also writes canvas-documents/{plans,applies}/<runId>.{log,meta.json}
# in the ticket workdir — the backend's Logs-tab endpoints read exactly those files (reference/05 §7).
#
# actionName defaults to the verb; the FIRST provisioning run passes "provision" so the audit log
# distinguishes it from user-requested applies. DEPROVISION=1 turns a destroy into the deprovision
# lifecycle (posts DeProvisioning/DeProvisioned instead of Processing/Complete — reference/11).
set -uo pipefail

VERB="${1:?verb (plan|apply|destroy)}"
ACTION_NAME="${2:-$VERB}"
# Exported: child scripts (spec-to-tfvars.sh) read the same spec file.
SPEC_FILE="${SPEC_FILE:-shared/network-stack.json}"; export SPEC_FILE
SPEC="$SPEC_FILE"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WS=$(jq -r '.ownerWorkspaceId' "$SPEC"); ID=$(jq -r '.id' "$SPEC"); NAME=$(jq -r '.name' "$SPEC")
BASE="${DUPLO_BASE:-$DUPLO_HOST}"
RES="$BASE/v1/aiservicedesk/user/data/workspaces/$WS/environment/extensions/network-stacks/$ID"
AUTH=(-H "Authorization: Bearer $DUPLO_TOKEN" -H "Content-Type: application/json")

post_status() { curl -fsS -X POST "$RES/status" "${AUTH[@]}" -d "$1" >/dev/null || true; }
post_results() { curl -fsS -X POST "$RES/results" "${AUTH[@]}" -d @"$1" >/dev/null || true; }

# ── single-flight guard (reference/05 §7): one terraform run per ticket at a time. A live lock means a
# run is in flight. A duplicate plan/apply is SKIPPED (exit 3, no status post — never regress the current
# status); a DEPROVISION must not be dropped, so it WAITS for the lock instead. ──
LOCK="${TICKET_DIR:-.}/shared/.run-lock"
mkdir -p "$(dirname "$LOCK")"
lock_held() { [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; }
if lock_held; then
  if [ "${DEPROVISION:-}" = "1" ]; then
    echo "a run is in flight — deprovision waits for it (up to 30 min)" >&2
    WAITED=0
    while lock_held && [ "$WAITED" -lt 1800 ]; do sleep 15; WAITED=$((WAITED + 15)); done
    lock_held && { echo "lock still held after 30 min — aborting destroy, retry the delete" >&2; exit 3; }
  else
    echo "a run is already in progress — skipped duplicate $VERB (exit 3; resource status unchanged)" >&2
    exit 3
  fi
fi
# The lock tracks the DETACHED terraform runner's PID once launched (the watcher can die while terraform
# lives on). Until then it holds the watcher's PID. The EXIT trap frees the lock only when the run is
# actually over — RCFILE consumed, or the runner is no longer alive.
echo $$ > "$LOCK"
RUNNER_PID=""
trap 'if [ -z "$RUNNER_PID" ] || ! kill -0 "$RUNNER_PID" 2>/dev/null; then rm -f "$LOCK"; fi' EXIT

# ── per-run artifacts (the FE Logs tab lists/reads these through the backend) ──
KIND=plans; [ "$VERB" != "plan" ] && KIND=applies
RUNDIR="${TICKET_DIR:-.}/canvas-documents/$KIND"; mkdir -p "$RUNDIR"
RUNID="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)"
META="$RUNDIR/$RUNID.meta.json"; LOG="$RUNDIR/$RUNID.log"
RAN_AT="$(date -u +%FT%TZ)"
: > "$LOG"
jq -nc --arg r "$RUNID" --arg t "$RAN_AT" --arg v "$VERB" \
  '{runId:$r,ranAt:$t,verb:$v,running:true,success:false,hasDiff:false,summary:("terraform "+$v+" running…")}' > "$META"

# Result accumulator — merged and re-POSTed whole after every run so nothing is lost between runs.
RESULT_STORE="${TICKET_DIR:-.}/shared/.result.json"
[ -f "$RESULT_STORE" ] || echo '{"actions":[],"modules":[]}' > "$RESULT_STORE"

# Early failure = a real, finished run: finalize the meta (no phantom running:true forever), consume the
# request stamp (a failed action must NOT re-run on every later reconcile message), post Failed, exit 1.
fail_early() {
  jq -nc --arg r "$RUNID" --arg t "$RAN_AT" --arg v "$VERB" --arg s "$1" \
    '{runId:$r,ranAt:$t,verb:$v,running:false,success:false,hasDiff:false,summary:$s}' > "$META"
  REQ_AT="$(jq -r '.spec.lastRequestedAction.requestedAt // empty' "$SPEC")"
  [ -n "$REQ_AT" ] && printf '%s' "$REQ_AT" > "${TICKET_DIR:-.}/shared/.last-action-processed"
  post_status "$(jq -nc --arg s "$1" '{status:"Failed",faults:[$s]}')"
  echo "FAILED: $1" >&2
  exit 1
}

# ── writable terraform workdir: the skill bundle mounts READ-ONLY; state persists here across runs ──
TFROOT="${TICKET_DIR:-.}/.tf-work"; export TFROOT
mkdir -p "$TFROOT"
cp -R "$SKILL_DIR/_terraform/." "$TFROOT/" 2>>"$LOG" || fail_early "cannot copy terraform tree into the workdir"
bash "$SKILL_DIR/scripts/spec-to-tfvars.sh" >>"$LOG" 2>&1 || fail_early "spec-to-tfvars failed — is the spec complete?"

if [ "${DEPROVISION:-}" = "1" ]; then
  post_status "$(jq -nc --arg v "$VERB" '{status:"DeProvisioning",subStatus:("terraform "+$v+" started")}')"
else
  post_status "$(jq -nc --arg v "$VERB" '{status:"Processing",subStatus:("terraform "+$v+" started")}')"
fi

# ── module map (single source): result module key -> label -> terraform address prefix.
# post_modules, the watch loop and the terminal posts are ALL driven from these three arrays —
# add a module here and everything else follows. ──
MODULE_KEYS=(vpc subnets security)
MODULE_LABELS=("VPC" "Subnets" "Security Group")
MODULE_ADDRS=("aws_vpc.this" "aws_subnet.this" "aws_security_group.this")

post_modules() { # $1 = space-separated per-key statuses, aligned with MODULE_KEYS
  read -ra STS <<< "$1"
  local mods='[]' i
  for i in "${!MODULE_KEYS[@]}"; do
    mods="$(jq -c --arg k "${MODULE_KEYS[$i]}" --arg l "${MODULE_LABELS[$i]}" --arg s "${STS[$i]:-NotStarted}" \
      '. + [{key:$k,label:$l,status:$s}]' <<<"$mods")"
  done
  jq --argjson m "$mods" '.modules = $m' \
    "$RESULT_STORE" > "$RESULT_STORE.tmp" && mv "$RESULT_STORE.tmp" "$RESULT_STORE"
  post_results "$RESULT_STORE"
}

all_modules_status() { # $1 = one status for every module (e.g. Created)
  local out="" _k
  for _k in "${MODULE_KEYS[@]}"; do out+="$1 "; done
  echo "${out% }"
}

current_module_statuses() {
  local out="" addr
  for addr in "${MODULE_ADDRS[@]}"; do out+="$(module_status_from_log "$addr") "; done
  echo "${out% }"
}

module_status_from_log() { # $1 = terraform address prefix -> NotStarted|Creating|Created|Destroying|Destroyed|Failed
  local addr="$1"
  if grep -q "$addr.*: Creation complete" "$LOG"; then echo Created
  elif grep -q "$addr.*: Destruction complete" "$LOG"; then echo Destroyed
  elif grep -qE "Error.*$addr|$addr.*Error" "$LOG"; then echo Failed
  elif grep -q "$addr.*: Destroying" "$LOG"; then echo Destroying
  elif grep -qE "$addr.*: (Creating|Modifying|Still creating)" "$LOG"; then echo Creating
  else echo NotStarted; fi
}

# ── launch terraform DETACHED, then watch it with a sleep loop ──
RCFILE="$TFROOT/.$RUNID.rc"
case "$VERB" in
  plan)    TF_ARGS=(plan -detailed-exitcode) ;;
  apply)   TF_ARGS=(apply -auto-approve) ;;
  destroy) TF_ARGS=(destroy -auto-approve) ;;
  *) echo "bad verb $VERB" >&2; exit 2 ;;
esac
# The rc is written to a temp file then mv'd (atomic) so the watcher can never read a truncated/empty rc.
nohup bash -c "cd '$TFROOT' \
  && terraform init -input=false -no-color \
  && terraform ${TF_ARGS[*]} -input=false -no-color -lock-timeout=120s -var-file=stack.tfvars.json; \
  echo \$? > '$RCFILE.tmp' && mv '$RCFILE.tmp' '$RCFILE'" >>"$LOG" 2>&1 &
RUNNER_PID=$!
# From here the lock guards the RUNNER: even if this watcher dies, the lock stays honest until terraform exits.
echo "$RUNNER_PID" > "$LOCK"

LAST=""
while [ ! -f "$RCFILE" ]; do
  sleep 10
  if [ "$VERB" != "plan" ]; then                       # a plan mutates nothing — no module flips to report
    CUR="$(current_module_statuses)"
    if [ "$CUR" != "$LAST" ]; then post_modules "$CUR"; LAST="$CUR"; fi
  fi
  post_status "$(jq -nc --arg v "$VERB" --arg l "$(tail -c 200 "$LOG" | tail -1 | cut -c1-160)" \
    --arg st "$([ "${DEPROVISION:-}" = "1" ] && echo DeProvisioning || echo Processing)" \
    '{status:$st,subStatus:("terraform "+$v+": "+$l)}')"
done
RC="$(cat "$RCFILE" 2>/dev/null || echo 1)"; rm -f "$RCFILE"

# ── classify + finalize the run meta ──
HAS_DIFF=false; SUCCESS=false
if [ "$VERB" = "plan" ]; then
  case "$RC" in 0) SUCCESS=true ;; 2) SUCCESS=true; HAS_DIFF=true ;; esac
else
  [ "$RC" -eq 0 ] && SUCCESS=true
fi
SUMMARY="$(grep -E '^(Plan:|No changes|Apply complete|Destroy complete|Error:)' "$LOG" | tail -1)"
[ -z "$SUMMARY" ] && SUMMARY="terraform $VERB $([ "$SUCCESS" = true ] && echo succeeded || echo failed)"
FIN_AT="$(date -u +%FT%TZ)"
jq -nc --arg r "$RUNID" --arg t "$RAN_AT" --arg v "$VERB" --argjson ok "$SUCCESS" --argjson d "$HAS_DIFF" --arg s "$SUMMARY" \
  '{runId:$r,ranAt:$t,verb:$v,running:false,success:$ok,hasDiff:$d,summary:$s}' > "$META"

# ── outputs + final module states ──
OUTPUTS='{}'
if [ "$VERB" = "apply" ] && [ "$SUCCESS" = true ]; then
  terraform -chdir="$TFROOT" output -json > /tmp/tfout.$$.json 2>/dev/null || echo '{}' > /tmp/tfout.$$.json
  OUTPUTS="$(jq -c '{vpcId:(.vpc_id.value // null), subnetIds:(.subnet_ids.value // []), securityGroupId:(.security_group_id.value // null)} | with_entries(select(.value != null))' /tmp/tfout.$$.json)"
  rm -f /tmp/tfout.$$.json
  post_modules "$(all_modules_status Created)"
elif [ "$VERB" = "destroy" ] && [ "$SUCCESS" = true ]; then
  OUTPUTS='{"vpcId":null,"subnetIds":[],"securityGroupId":null}'
  post_modules "$(all_modules_status Destroyed)"
elif [ "$VERB" != "plan" ] && [ "$SUCCESS" != true ]; then
  # Failed apply/destroy: heal the module list — terraform prints its error as a multi-line block the
  # per-address grep can't attribute, so anything not terminal-Created/Destroyed flips to Failed here
  # (otherwise the Overview tab shows "Creating" forever against a Failed resource).
  HEALED=""
  for S in $(current_module_statuses); do
    case "$S" in Created|Destroyed) HEALED+="$S " ;; *) HEALED+="Failed " ;; esac
  done
  post_modules "${HEALED% }"
fi

# ── append the audit entry + POST the merged result ──
REQ_BY="$(jq -r '.spec.lastRequestedAction.requestedBy // empty' "$SPEC")"
STATUS_TXT=$([ "$SUCCESS" = true ] && echo Complete || echo Failed)
ENTRY="$(jq -nc --arg a "$ACTION_NAME" --arg ra "$RAN_AT" --arg fa "$FIN_AT" --arg st "$STATUS_TXT" \
  --arg sm "$SUMMARY" --arg rid "$RUNID" --arg rb "$REQ_BY" --argjson hd "$HAS_DIFF" \
  '{action:$a,requestedAt:$ra,requestedBy:$rb,startedAt:$ra,finishedAt:$fa,status:$st,summary:$sm,runId:$rid,hasDiff:$hd}')"
jq --argjson o "$OUTPUTS" --argjson e "$ENTRY" --argjson d "$HAS_DIFF" \
  '. * $o | .actions = ((.actions // []) + [$e]) | .lastPlanHasDiff = $d' \
  "$RESULT_STORE" > "$RESULT_STORE.tmp" && mv "$RESULT_STORE.tmp" "$RESULT_STORE"
post_results "$RESULT_STORE"

# ── idempotency stamp (reference/05 §7): record WHICH request this run consumed, success or not — a
# failed run still consumed it, and re-running a stale action on the next reconcile message would be
# worse. The dispatch in SKILL.md only acts on lastRequestedAction when requestedAt differs from this. ──
REQ_AT="$(jq -r '.spec.lastRequestedAction.requestedAt // empty' "$SPEC")"
[ -n "$REQ_AT" ] && printf '%s' "$REQ_AT" > "${TICKET_DIR:-.}/shared/.last-action-processed"

# ── terminal status. A failed on-demand PLAN does not fail the resource — the infra is untouched. ──
if [ "${DEPROVISION:-}" = "1" ]; then
  [ "$SUCCESS" = true ] && post_status "$(jq -nc --arg s "$SUMMARY" '{status:"DeProvisioned",subStatus:$s}')" \
                        || post_status "$(jq -nc --arg s "$SUMMARY" '{status:"Failed",faults:[$s]}')"
elif [ "$VERB" = "plan" ]; then
  post_status "$(jq -nc --arg s "$SUMMARY" --argjson ok "$SUCCESS" \
    '{status:"Complete",subStatus:(if $ok then ("Plan recorded — "+$s) else ("Plan FAILED — see the Logs tab: "+$s) end)}')"
else
  [ "$SUCCESS" = true ] && post_status "$(jq -nc --arg s "$SUMMARY" '{status:"Complete",subStatus:$s}')" \
                        || post_status "$(jq -nc --arg s "$SUMMARY" '{status:"Failed",faults:[$s]}')"
fi
exit "$([ "$SUCCESS" = true ] && echo 0 || echo 1)"
