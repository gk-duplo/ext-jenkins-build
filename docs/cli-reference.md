# CLI reference

Every entry point in the dev kit, its flags, and what it does.

- [`run.sh`](#runsh)
- [`stop.sh`](#stopsh)
- [`logs.sh`](#logssh)
- [What each command destroys](#what-each-command-destroys)
- [`scripts/`](#scripts)
- [CI workflows](#ci-workflows)

## `run.sh`

Interactive, idempotent setup and start. Prompts only for values that are not already set, so re-running
it is safe and silent.

```bash
./run.sh
./run.sh --reset
./run.sh --license <jwt>
./run.sh --email you@yourcompany.com --password 'pw' --model anthropic --anthropic-key sk-ant-...
./run.sh --model bedrock --aws-access-key-id AKIA... --aws-secret-access-key ... [--aws-session-token ...] [--aws-region us-west-2]
./run.sh --model bedrock-instance-role [--aws-region us-east-1]
```

On an EC2 host the provider prompt first probes whether the instance role can actually invoke Bedrock
(see [`detect-bedrock.sh`](#platform-registration)) and, if so, offers it as a third, keyless option.

| Flag | Effect |
| --- | --- |
| `--reset` | Tear down the stack **and its volumes**, then blank the configured `.env` values and set up fresh. Your license is kept. Destructive — see the table below. |
| `--reset-license` | Forget the license as well: the JWT and both ids it can be re-fetched from. Prints the JWT to stderr first, because DuploCloud will not issue a second one for your address. Refused when the run cannot prompt (`-y`, or no tty) and no `--license` replaces it. |
| `--license <jwt>` | Use a license JWT you already have. No licensing call is made. |
| `--non-interactive`, `-y` | Never prompt. A missing required value is an error instead: `Missing <KEY> — pass its flag (non-interactive).` |
| `--email <addr>` | Admin email (your UI login, and the address the license is issued to). Must be a **work** address; personal domains are rejected by the license server. |
| `--password <pw>` | Admin password. |
| `--model <1\|2\|3\|anthropic\|bedrock\|bedrock-instance-role>` | LLM provider. `1` is anthropic, `2` is bedrock, `3` is bedrock-instance-role. Option `3` is only offered at the prompt when the probe proves the role can invoke Bedrock, but `--model bedrock-instance-role` can be passed directly — it then probes and **fails** rather than falling back, since you asked for it explicitly. |
| `--anthropic-key <key>` | Anthropic API key. |
| `--aws-access-key-id <id>` | Bedrock credentials. Not used by `bedrock-instance-role`, which stores no keys. |
| `--aws-secret-access-key <key>` | Bedrock credentials. |
| `--aws-session-token <token>` | Bedrock session token, if you use temporary credentials. |
| `--aws-region <region>` | Bedrock region. Defaults to `us-west-2` for `bedrock`. For `bedrock-instance-role` it skips the probe and uses this region directly. |
| `--no-metrics` | Opt out of usage metrics. The default is opted **in**. |
| `--metrics` | Opt back in. |
| `--studio-tag <tag>` | Override and **pin** `STUDIO_TAG`. It stops tracking `.env.example`. |
| `--ui-tag <tag>` | Override and pin `UI_TAG`. |
| `--agent-tag <tag>` | Override and pin `AGENT_TAG`. |
| `-h`, `--help` | Print the header comment and exit. |

**What a run does, in order:**

1. Checks its prerequisites and exits, listing everything missing at once, if `python3`, `docker`, or the
   `docker compose` v2 subcommand is absent. A stopped daemon is only a warning here — `docker compose
   pull` reports it better. `--help` is answered before this check, so it works on a bare machine.
2. Creates `.env` from `.env.example` if it is missing.
3. Adopts any changed framework defaults from `.env.example` — see [upgrading.md](upgrading.md#how-defaults-are-adopted).
4. Resolves the admin email: flag, then `.env`, then prompt.
5. Obtains a license for that address if `Licensing__Token` is empty — see
   [configuration.md § Licensing](configuration.md#licensing). This is where a run can wait on you: the
   license server emails the address a link, and the run polls for up to 2 minutes after it is clicked.
6. Resolves password, LLM provider, and the metrics choice: flag, then `.env`, then prompt.
7. Generates `Encryption__MasterKey` and `Authentication__JwtSharedSecret` once, if unset.
8. `docker compose pull`, then `docker compose up -d`.
9. Waits up to ~4.5 minutes for the studio to answer on `/healthz` — an anonymous route, because this
   happens before the admin token exists.
10. Mints a permanent admin API token into `DUPLO_ADMIN_TOKEN`, revoking its own prior `dev-kit-admin`
    tokens first (the server caps active tokens per user at 10).
11. Creates the `extension-dev` workspace if absent.
12. Creates the `extension-dev-access` permission set and `extension-dev-group`, granting your admin user
    UI access to that workspace.
13. Registers and attaches the agent (`scripts/register-agent.sh`).
14. Vendors the Terraform extension's source into `extensions/terraform/` if it is not already there
    (`scripts/fetch-terraform-extension.sh`). Never fatal — an unreachable source repo does not stop
    the platform coming up.
15. On an Anthropic setup, registers the local model as the System default (`scripts/register-llm.sh`).

Steps 10–15 are each idempotent and skipped when already satisfied. So is step 5: a license already in
`.env` is used as-is, and a run that was interrupted mid-verification resumes from the request id it saved.

## `stop.sh`

```bash
./stop.sh            # docker compose down     — volumes kept
./stop.sh --wipe     # docker compose down -v  — volumes removed
```

Without `--wipe`, loaded extensions and all data survive and replay on the next `./run.sh`. With `--wipe`,
extensions, Mongo, and the file store are lost.

## `logs.sh`

```bash
./logs.sh                     # tail everything
./logs.sh duplo-ai-studio     # tail one service
./logs.sh --no-follow         # dump and exit, instead of following
```

A thin wrapper around `docker compose logs -f`; every argument is passed straight through. Services are
`duplo-ai-studio`, `claude-code-agent`, `duplo-ui`, `mongo`, and `xterm`.

## What each command destroys

| | Containers | Volumes (extensions, Mongo, file store) | Configured `.env` values | License |
| --- | --- | --- | --- | --- |
| `./stop.sh` | stopped | **kept** | kept | kept |
| `./stop.sh --wipe` | stopped | **destroyed** | kept | kept |
| `./run.sh --reset` | stopped | **destroyed** | **blanked** | kept |
| `./run.sh --reset-license` | untouched | untouched | kept | **blanked** |

A license is not stack state, so `--reset` leaves it alone — nothing about a fresh DB invalidates it, and
the server issues exactly one per email address. `--reset-license` is how you ask for it to go away; the two
combine.

`--reset` blanks these keys, then sets up fresh: `Authentication__LocalAdminEmail`,
`Authentication__LocalAdminPassword`, `Authentication__SuperUsers`, `DEVKIT_MODEL`, `ANTHROPIC_API_KEY`,
`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `Encryption__MasterKey`,
`Authentication__JwtSharedSecret`, `DUPLO_ADMIN_TOKEN`, `EXTENSION_DEV_WORKSPACE_ID`,
`EXTENSION_DEV_PERMSET_ID`, `EXTENSION_DEV_PERMSETGROUP_ID`, `DUPLO_USAGE_METRICS`, `METRICS_CONF`.

`--reset` is the **only** thing that clears provider credentials — normal restarts never touch them, so
use it to switch providers cleanly. Blanking `AWS_REGION` is also what forces `bedrock-instance-role` to
re-probe on the next run instead of reusing the region already in `.env`.

`--reset-license` blanks the four licensing keys and nothing else: `Licensing__Token`,
`LICENSE_TRIAL_UUID`, `LICENSE_RECOVERY_UUID`, `LICENSE_REQUEST_EMAIL`. Dropping the ids is what makes it
irreversible from the CLI — they are the handles a later run would otherwise use to pull the same license
back down.

You rarely need it to change address, though. `--email` alone is enough while a request is still unverified:
a saved id can only verify the address it was made for, so giving a different admin email discards the id and
requests afresh. That is the way out of a mistyped email — the one case where waiting for the link is futile,
because it went somewhere you can't read.

Your `extensions/` directory is **never** touched by any of these — it is only ever on disk.

## `scripts/`

### Adopting and upgrading

| Script | What it does |
| --- | --- |
| `init-project.sh <remote-url> [--keep-history] [--no-sample] [--name <slug>]` | Adopt this clone as your own repo **and** seed a first extension under `extensions/<name>/` (default `helloworld`). Starts a fresh git history unless `--keep-history`. |
| `change_git_owner.sh <remote-url> [--keep-history]` | Re-point `origin` at your remote without seeding anything. |
| `upgrade_dev_kit.sh [--version <ref>] [--yes]` | Refresh the framework to a branch, tag, or commit (default `main`). See [upgrading.md](upgrading.md). |
| `fetch-terraform-extension.sh [--force]` | Vendor the real Terraform extension's source into `extensions/terraform/`. Fetches **only** that subdirectory — a blobless partial fetch with a sparse path — and what lands is plain source with no `.git`, no remote and no upstream. Skips if the directory exists, so your edits survive; `--force` moves the old copy to `.bak` first. Override with `TF_EXT_REPO` / `TF_EXT_REF`. |

### Building and deploying

| Script | What it does |
| --- | --- |
| `build-extension.sh <extension-dir>` | Validate naming, fetch the host SDK, `dotnet publish`, `npm build`, and zip to `<dir>/dist/extension.zip`. |
| `build-all.sh` | Build every `extensions/<name>/manifest.json` in the repo. What CI runs. |
| `deploy-extension.sh <path-to-extension.zip>` | Hot-load one bundle onto the platform — no restart. |
| `deploy-all.sh` | Hot-load every built bundle. Run after `build-all.sh`. |
| `remove-extension.sh <extension-id>` | Unload and delete a loaded extension by its manifest id, e.g. `duplo.examples.helloworld`. |

`build-extension.sh` refuses to build an extension whose naming is wrong — REST segments must start with
`extensions/`, Mongo collections must be prefixed `extension_`, and template `Hello`/`hw-` identifiers must
be renamed. Each violation prints a `✗` line, then:

```
ERROR: extension naming validation failed — fix the ✗ items above (reference/00-naming.md).
```

### Platform registration

| Script | What it does |
| --- | --- |
| `register-agent.sh [workspace-id]` | Register the bundled `claude-code-agent` and attach it to a workspace. Provisioning tickets are assigned from the workspace's agent list, so a resource only provisions once its workspace has an agent. Local stack only. |
| `register-llm.sh [model-id]` | Register the model the agent actually runs on and make it the sole System default, so the ticket LLM picker offers exactly that model. Provider-agnostic: defaults to `CLAUDE_MODEL`, which `run.sh` sets per provider — a bare id for direct Anthropic, a `us.anthropic.*` inference-profile id for either Bedrock mode. The two are not interchangeable. `LLM_PROVIDER_LABEL` suffixes the display name. |
| `detect-bedrock.sh [model-id] [region]` | Probe whether this host is an EC2 instance whose IAM role can invoke Bedrock. Makes a real 1-token Converse call against the model (default `us.anthropic.claude-sonnet-4-6`) and separately checks a container can reach IMDS. Needs only `python3` and `curl` — SigV4 is signed with the standard library, no AWS CLI or boto3. Prints `BEDROCK_REGION`, `AWS_ROLE`, `CONTAINER_IMDS` (`ok` / `blocked` / `unknown:<why>`), and `BEDROCK_REASON` as `KEY=value` lines for `run.sh` to consume; safe to run standalone. |
| `setup-google-auth.sh [--force] [--grant --sa <sa-email>]` | One-time setup for keyless GCP scopes. Ensures `gcloud auth application-default login` has run — plain `gcloud auth login` does not write the ADC file the studio reads. |
| `refresh-common-lib.sh <tarball>` | Refresh the vendored `@duplocloud-internal/ng-common-lib` tarball across every sample and the skill template. See [UPGRADING-ng-common-lib.md](UPGRADING-ng-common-lib.md). |

### Internal helpers

`_target.sh` resolves the base URL and token from `DUPLO_TARGET`; `_devkit.sh` holds the fixed official
dev-kit URL used by upgrades. Both are sourced, not run.

## CI workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/extension-ci.yml` | push | Builds `extensions/`. Can hot-load on a manual run. |
| `.github/workflows/release.yml` | push to `main`, or manual | Builds every extension and cuts a GitHub Release with `extension.zip` attached — but only when `manifest.version` is new and its `<name>-v<version>` tag does not exist. Bumping `manifest.version` is how you publish. The deploy step is intentionally commented out. |

Both need repo secrets `DUPLO_HOST` and `DUPLO_TOKEN`. The build fetches the host SDK feed from
`DUPLO_HOST`, so it must be reachable from CI — a real platform, not `localhost`.

It is your repo: commit `extensions/` and push. `dist/`, `node_modules/`, and `backend/sdk-packages/` are
gitignored, and `.env` is never committed.
