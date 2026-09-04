# Sourced by run.sh — usage-metrics opt-in/opt-out resolution.
#
# The UI ships as a published image with the Mixpanel key baked into its Angular bundle at build
# time, so the opt-out is applied by nginx: docker-compose mounts nginx/metrics-{on,off}.conf over
# /etc/nginx/metrics.conf and default.conf includes it. Design:
# docs/plans/2026-08-01-usage-metrics-optout-design.md

# metrics_conf_for <1|0> → the nginx fragment filename implementing that choice.
metrics_conf_for() {
  if [ "$1" = 1 ]; then printf 'metrics-on.conf'; else printf 'metrics-off.conf'; fi
}

# metrics_resolve <flagval> <envval> <noninteractive> → 1 (opted in) or 0 (opted out).
#
# Precedence: --metrics/--no-metrics > .env DUPLO_USAGE_METRICS > prompt. The default is opted IN.
#
# Never a TTY trap: under --non-interactive/-y, or with no TTY on stdin, take the default silently
# instead of failing. Unlike the email/password prompts this value has a defensible default, so a
# missing answer is not an error.
# NOTE: when run.sh's resolve() grows general TTY gating, fold this check into it there.
metrics_resolve() {
  local flagval="$1" envval="$2" noninteractive="$3" ans=""
  if [ -n "$flagval" ]; then printf '%s' "$flagval"; return; fi
  if [ -n "$envval" ]; then
    # Anything that is not exactly 1 means off — fail closed. Canonicalize to 1/0 on the way out so
    # .env converges to the value it actually behaves as, instead of storing a junk string forever.
    if [ "$envval" = 1 ]; then printf '1'; else
      [ "$envval" = 0 ] || printf 'DUPLO_USAGE_METRICS=%s is not 1 or 0 — treating as opted out.\n' "$envval" >&2
      printf '0'
    fi
    return
  fi
  if [ "$noninteractive" = 1 ] || [ ! -t 0 ]; then printf '1'; return; fi
  printf '%s\n' 'DuploCloud collects product usage metrics from this dev kit.' >&2
  # EOF (Ctrl-D) takes the default rather than aborting the run — this value has one, unlike the
  # email/password prompts. Written explicitly so it does not depend on inherit_errexit being unset.
  if ! read -r -p 'Opt out of usage metrics? [y/N]: ' ans; then printf '\n' >&2; ans=""; fi
  case "$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')" in
    y|yes) printf '0' ;;
    *)     printf '1' ;;
  esac
}
