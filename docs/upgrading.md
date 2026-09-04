# Upgrading

Taking newer dev-kit framework versions without losing your extensions or your configuration.

## The short version

```bash
./scripts/upgrade_dev_kit.sh --version <branch|tag|commit>   # default: main
./run.sh
```

`extensions/` and `.env` are never touched. The next `./run.sh` adopts any changed framework defaults —
new image tags — into your `.env` automatically, while keeping anything you pinned.

## What the upgrade replaces

`upgrade_dev_kit.sh` clones the dev kit from a **fixed official URL** — hardcoded in `scripts/_devkit.sh`,
never taken from your `git remote` or user input, so an adopted repo cannot redirect a framework upgrade at
an untrusted source. It then refreshes only an allowlist of framework-owned paths.

| Kind | Paths | Behavior |
| --- | --- | --- |
| Wholly framework-owned | `.claude/` `.github/` `nginx/` `packages/` `samples/` `scripts/` | Mirrored, including deletion of stale files **inside** those directories. |
| Shared with you | `docs/` | Framework files are overwritten and added; **nothing is deleted**, so docs you write here survive. |
| Individual files | `.env.example` `.gitignore` `docker-compose.yml` `logs.sh` `README.md` `run.sh` `stop.sh` | Overwritten in place, never deleted. |

Everything else — `extensions/`, `.env`, compose overrides, and any file you add — is preserved.

Flags:

| Flag | Effect |
| --- | --- |
| `--version <ref>` | Branch, tag, or commit to move to. Default `main`. |
| `--yes`, `-y` | Skip the interactive confirmation, for scripted or CI use. |

> **Note:** the acquisition model is under active change. If you adopted the kit with `init-project.sh`,
> the flow above is current.

## How defaults are adopted

Framework-shipped defaults — the image tags and `STUDIO_PLATFORM` — live in
`.env.example`. An upgrade changes that file, but it never touches your `.env`. `run.sh` bridges the two on
every run.

The tracked keys are `STUDIO_TAG`, `AGENT_TAG`, `UI_TAG`, `XTERM_TAG`, and `STUDIO_PLATFORM`. Nothing
licensing-related is adopted or overwritten this way — `Licensing__Token` is yours, not a framework
default, and the license server URL is a built-in rather than a shipped `.env` value.

For each one, `run.sh` compares three values:

| Value | Source |
| --- | --- |
| the new default | `.env.example` |
| the last-applied default | `.env.defaults` — gitignored bookkeeping, rewritten every run |
| your current value | `.env` |

If your current value is empty or still equals the last-applied default, you have not diverged, so the new
default is adopted. If it differs, you pinned it — and it is kept. Adoptions are announced:

```
==> Adopted updated defaults from .env.example: STUDIO_TAG=branch-main-abc1234
```

### Pinning a tag

Pass `--studio-tag`, `--ui-tag`, or `--agent-tag`, or hand-edit `.env`. Either way the key stops tracking
`.env.example` and stays where you put it across upgrades.

### Un-pinning a tag

Delete its line from `.env` — or from `.env.defaults` — and re-run `./run.sh`. It resumes tracking the
framework default.

## Upgrading the vendored UI library

The `@duplocloud-internal/ng-common-lib` tarball that samples build against is vendored, not fetched from a
registry. Refreshing it is a separate procedure with its own constraints — see
[UPGRADING-ng-common-lib.md](UPGRADING-ng-common-lib.md).

The tarball is proprietary and is **not** covered by the Apache license on the rest of the kit. See
[TERMS.md](../TERMS.md).

## After an upgrade

1. `./run.sh` — picks up new image tags and re-runs the idempotent setup steps.
2. Rebuild and redeploy your extensions. The build compiles against the SDK published by the running
   platform, so a studio image change can mean a new SDK:

   ```bash
   ./scripts/build-all.sh && ./scripts/deploy-all.sh
   ```

3. If a build fails right after an upgrade, start with
   [the host-SDK entry in troubleshooting](troubleshooting.md#the-extension-build-cannot-reach-the-host-sdk).
