---
name: duplo-extension-dev
description: Build and load a DuploCloud platform extension (a typed extension — C# ResourcesController + service + entity, plus an Angular remote and a provisioning skill) and hot-load it into the platform. Works both inside a Extension resource's provisioning ticket and locally (you supply the platform URL + an admin token). Scaffolds from the hello-world example, compiles the backend with dotnet against the host SDK feed, packages, and registers — no host restart.
---

# duplo-extension-dev — write a DuploCloud platform extension

You build a **platform extension**: a brand-new, first-class DuploCloud **Resource type** with its own
C# `ResourcesController` + service + entity (own Mongo collection + REST route), an Angular
Native-Federation remote (list/add/view), and a provisioning skill. The studio **hot-loads** the
compiled DLL — per-extension DI container + live routes, no restart — so the result is indistinguishable
from a built-in resource (Network, Namespace, …).

> ⚠️ **Writing any frontend code? Load the [`use-ng22`](../use-ng22/SKILL.md) skill first.** It is the
> ruling on the Angular 22 shape every extension UI is written in — standalone components, signals, the
> **OnPush-by-default trap** that silently stops async data from rendering, `inject()`, `@if`/`@for`, and a
> `Routes` export instead of an NgModule. The `helloworld` template below is already written to it, so
> scaffolding from the template gives you the modern shape by default; deviate only with a reason. The
> exhaustive per-API catalogue is [`use-ng22/reference/patterns.md`](../use-ng22/reference/patterns.md).

> **Read the reference docs in [`reference/`](reference/) — they are the source of truth:**
> [01-architecture](reference/01-architecture.md) (the model + provisioning loop + hot-load),
> [02-authoring-guide](reference/02-authoring-guide.md) (the common path),
> [03-base-classes](reference/03-base-classes.md) (every base class/method),
> [04-hooks](reference/04-hooks.md) (every hook + when it fires),
> [05-custom-actions](reference/05-custom-actions.md) (logs, lifecycle actions, view-template menus, and extra
>   controller APIs your remote consumes),
> [06-registration](reference/06-registration.md) (in-platform vs local, SDK versioning),
> [07-scope-credentials](reference/07-scope-credentials.md) (reading the selected scopes' credentials — incl.
>   custom external HTTP APIs — during provisioning),
> [08-parent-child-and-menus](reference/08-parent-child-and-menus.md) (multi-resource extensions + nested
>   left-hand menus),
> [09-result-templates](reference/09-result-templates.md) (the OPTIONAL declarative renderer — simple/static
>   results only),
> [10-sdk-api](reference/10-sdk-api.md) (**cloud access from C#** — `IScopeCredentials`/`IScopeClientFactory` to read
>   scope creds + build Kubernetes/AWS/GitHub clients for enrichment & passthrough),
> [11-deprovisioning](reference/11-deprovisioning.md) (delete/deprovision lifecycle per mode — the row is hard-deleted by default once teardown hits `DeProvisioned`),
> [12-enrichment-and-live-state](reference/12-enrichment-and-live-state.md) (fetch live infra state in C# +
>   the Result↔view-template contract, `[BsonIgnoreExtraElements]`, template registration),
> [13-current-user](reference/13-current-user.md) (get the logged-in user in the frontend, backend `ICurrentUser`,
>   and agent skill env vars),
> [14-forms-and-wizards](reference/14-forms-and-wizards.md) (form field components + the multi-step **wizard**
>   pattern — no library stepper, so copy the `samples/network-stack` stepper; per-step validation via ngModelGroup),
> [15-error-handling](reference/15-error-handling.md) (surface the REAL create/update error — read the response
>   `errors`, not the generic `message` title; use `formGroupErrors.reportError(err)` / `extractErrorMessage(err)`),
> [16-ask-ai](reference/16-ask-ai.md) (**OPT-IN** on-demand **Ask AI** chat sessions on a resource — dedicated
>   `<sub-type>-askai` subType + `metadata.purpose: "ask-ai"`, unlimited per resource, works in every
>   provisioning mode incl. Worker; build it ONLY when the user explicitly asks — never by default; renders as
>   the LAST tab of the Results tab strip),
> [17-custom-result-views](reference/17-custom-result-views.md) (custom **tabbed results** for complex
>   extensions — `ngbNav` inside the Result panel, per-tab panel components, lazy loading, polling; the
>   default for anything beyond the view-template's simple-field ceiling; worked example
>   `samples/network-stack`).

> **Every dev-kit extension is TYPED — there is no archetype choice.** A typed extension ships a compiled
> .NET DLL (`manifest.archetype = "typed"`) with the resource's own controller/route/collection, an Angular
> Native-Federation remote, and a provisioning skill. Start from the worked example at
> [`./templates/helloworld/`](templates/helloworld/) — keep its `backend/`; do **not** strip it.
> **Pure skill-based / no-DLL extensions are not supported in this dev-kit. Never ask the user to choose an
> archetype, and never offer skill-based as an option** — proceed typed unconditionally. (The dev ticket's
> message `"… provision extension"` and `spec.archetype` defaulting to `"typed"` are not archetype questions.)

## Phase 0 — detect the mode

- **In-platform** (run inside a Extension resource's provisioning ticket): `$DUPLO_TOKEN` **and**
  `$DUPLO_BASE` (or `$DUPLO_HOST`) are already set. The spec is at `shared/extension.json`;
  the scoped token authorizes ONLY this resource's `…/{id}/status|results|load|load-bundle` (it cannot
  GET arbitrary routes). Load via the **resource-scoped** endpoint and report status back on the Extension resource.
- **Local** (a developer runs this skill in Claude): those env vars are absent. **Ask the developer for
  the platform base URL and an admin bearer token** (a user with the `Administrator` role); export them
  as `DUPLO_BASE` and `DUPLO_TOKEN`. Load via the **admin** endpoint. Gather the resource shape
  conversationally (no ticket spec file).

Everything between Phase 1 and Phase 5 is identical in both modes; only the load step (Phase 6) differs.
See [06-registration](reference/06-registration.md) for full mechanics.

> **Getting the working copy.** The dev-kit repo is **PRIVATE**, so a **GitHub scope is required**; its token reaches
> `gh` (`.config/gh/hosts.yml` + `GH_CONFIG_DIR`), so clone with **`gh repo clone …`** (never an unauthenticated
> `git clone` of the dev-kit). 🔒 **Never read/print a credentials file** (`cat`/`echo`/`head`/`grep` of `hosts.yml`,
> `.aws/credentials`, …) — to verify GitHub auth use **`gh auth status`**, never `cat hosts.yml`.
> - **`spec.gitRepo` set (user's own repo):** `gh repo clone <orgName>/<name> repo` (with `-b <branch>`). If the repo
>   is **EMPTY**, overlay the dev-kit's content EXCEPT `.git` so the user repo keeps its own `.git`/ownership:
>   `gh repo clone duplocloud/devkit /tmp/devkit && rsync -a --exclude=.git /tmp/devkit/ repo/`.
>   If it **already has** dev-kit content, just work in it — but **enumerate first**: `ls extensions/*/manifest.json`.
>   Other developers' extensions may live beside yours; the requirement decides whether you MODIFY an existing
>   `extensions/<name>/` or scaffold a NEW `extensions/<name2>/` (ask when ambiguous), and before scaffolding new,
>   read a sibling to match its conventions. **Hot-load is on-demand**, **push is user-initiated only**
>   (chat or the result-page badge); prompt to **commit**/**resync** and report `result.gitStatus` after each git op.
> - **No `spec.gitRepo`:** `gh repo clone duplocloud/devkit` and work in it (throwaway, hot-load only).
> - **Local (human-cloned):** you already cloned the dev-kit. First time, run `./scripts/change_git_owner.sh <your-repo>`
>   to adopt it; if your repo already has dev-kit content, just work in it.
>
> In every case, author the extension in **`extensions/<extension_name>/`** at the repo root.

## Phase 1 — settle the resource shape (GATE: build nothing until this is unambiguous)

This is a hard gate. Do **not** run Phase 2 (or any scaffolding/build) until every item below is settled. A
loose one-line description (`"… provision extension"`, `"build me a thing for X"`) is **not** enough — derive what
you can, then **ask for the rest**. Guessing a shape and scaffolding it is a failure, not initiative.

**First, listen.** Get the user's requirement in plain English (in-platform: read `spec.description`). Do not fire
a checklist of questions before you have it. Then derive what you can and ask only for what's still ambiguous —
guessing a shape and scaffolding it is a failure, not initiative.

Settle before building (derive, else ask — **after** listening):
- **Name** — derive a suggested name from the requirement and **propose it back to the user to confirm or
  change** (never ask for a name before hearing the requirement). The agreed name gives **originType** (PascalCase
  → e.g. `HelloWorld`), **subType** (kebab, e.g. `hello-world`), and **restSegment** — which **MUST** be namespaced
  under `extensions/` → `extensions/<feature>-<resource>` (e.g. `extensions/helloworlds`). The frontend
  `routes[].path` and menu `relativeUrl` use the **same** `extensions/…` value. Never a bare or `clouds/…` segment —
  see the canonical rule in [00-naming](reference/00-naming.md) (the build gate enforces it).
  In a repo that already holds extensions, the name must collide with **no sibling** — including the frontend's
  federation remote `name` (two extensions keeping the template's remote name silently alias to whichever loaded
  first; see [08-parent-child-and-menus](reference/08-parent-child-and-menus.md)) and Mongo `extension_<entity>`
  collection names.
- **Spec fields** — each with name, type, and required/optional. **Result fields** — same.
- **Provisioning MODE** — decide HOW this resource is provisioned. **Do not default to an agent skill.** Pick by
  what the work actually is (derive from the requirement; confirm if unsure):
  | Mode | Choose when the requirement is… | Wiring | Sample |
  |---|---|---|---|
  | **Worker** | a **deterministic** job: pure compute, or **reconcile/apply multiple objects** with retry/drift; words like *"worker", "background", "compute", "reconcile", "keep in sync"*. **No LLM needed.** | service `NoSkillsFallbackMode => ProvisioningMode.Worker`; **no** skill / `skillMappings`; a `ResourceWorkerBase` whose `ApplyAsync` does the work + `SaveProgressAsync`; register `AddHostedService` in `IDuploExtension.Configure` | `samples/worker-compute` (compute) · `samples/worker-appstack` (k8s) |
  | **Agent** | the work genuinely needs the **LLM / open-ended automation** (multi-step cloud orchestration, CFN, talking to a SaaS API by reasoning). | map a skill (`skills` + `skillMappings`); the skill reads `shared/<subtype>.json`, does the work, POSTs `results`+`status` | `samples/helloworld` · `samples/network-stack` (long-running terraform + C# enrich + on-demand actions) |
  | **Passthrough** | create **one** external object **synchronously**, no agent, no loop. | override `ProvisionDirectAsync`/`UpdateDirectAsync`/`DeprovisionDirectAsync` (default `NoSkillsFallbackMode` = Passthrough) | `samples/passthrough-configmap` |
  | **No-provision** | **observe-only** / on-demand; nothing to create on save. | `IsProvisioningNeeded => false` | (one override — full wiring in [04-hooks](reference/04-hooks.md)) |
  > A resource that just transforms/computes its own inputs (e.g. "take two numbers, return sum and product") is a
  > **Worker**, NOT an agent skill — an agent skill is wasteful + non-deterministic for work the backend can do in
  > C#. Enrichment (live read-state) is **orthogonal** and composes with any mode (see reference/12).
  Full decision detail + seams: [03-base-classes](reference/03-base-classes.md), [04-hooks](reference/04-hooks.md).
- **Ask AI sessions (OPT-IN — never by default)** — unlimited user-created chat tickets on the resource,
  discriminated from the provisioning ticket by subType `<sub-type>-askai` +
  `originContext.metadata.purpose: "ask-ai"`. Build them ONLY when the requirement explicitly asks for them
  ("ask AI", "AI chat sessions", "on-demand tickets"); never offer or scaffold them unprompted. When
  requested: settle what the **prefilled context block** should contain (spec/result fields are the usual
  default — no hard rule) and implement from the recipe in [16-ask-ai](reference/16-ask-ai.md) (they work in
  every provisioning mode, incl. Worker).
- **Pick the matching SAMPLE and copy its patterns.** The samples are worked references — reaching the right one is
  half the battle. They live at the **dev-kit repo root: `<repo-root>/samples/<name>/`** (NOT under `.claude/skills/`;
  always resolve from the repo root, where Phase 0 leaves you). Note the two `helloworld`s: **`templates/helloworld`**
  is the scaffold you copy to *start*; **`samples/helloworld`** is a worked reference — don't confuse them. This index
  is the single source for requirement → sample (both the provisioning-mode axis above and the frontend-shape/topology
  axis):

  | The requirement / UI shape is… | Copy patterns from | Don't confuse with |
  |---|---|---|
  | a **simple** create form — a few flat fields | `templates/helloworld` (scaffold) · `samples/helloworld` | — |
  | a **linear, step-by-step / wizard** flow (Step 1→2→3, Next/Back) | `samples/network-stack` (its 3-step add wizard + `wizard/wizard-stepper.component.ts`) | — |
  | **many fields / conditional sections / repeatable rows** | `samples/network-stack` (repeatable subnet rows in the Network step) | — |
  | one resource that **owns many** of another (parent → child) | `samples/parent-child` | flat independent multi-resource |
  | provision real infra **and** show live state on every GET | `samples/network-stack` (`EnrichResultAsync` + the Network tab) | — |
  | **long-running provisioning** (background terraform/process watched by the agent), on-demand **plan/apply** actions, execution **logs**, **tabbed results** | `samples/network-stack` | — |
  | create/update/delete **one** object synchronously (Passthrough) | `samples/passthrough-configmap` | — |
  | **reconcile/apply multiple** objects with retry (Worker, real infra) | `samples/worker-appstack` | worker-compute (compute-only) |
  | pure **compute**, no cloud/scope (Worker) | `samples/worker-compute` | worker-appstack (real infra) |
  | **observe-only** (No-provision) | wiring is one override — `IsProvisioningNeeded => false` (full wiring in [04-hooks](reference/04-hooks.md)); on-demand actions: `samples/network-stack` | — |

  **Forms tiebreaker:** linear steps you advance through, or lots of fields/toggles/repeatable rows → copy from
  **network-stack**'s wizard; a handful of flat fields → **helloworld**. (The form axis and the provisioning-mode
  axis are independent — e.g. a wizard-shaped resource can still be Worker-provisioned; pick one row from each axis.)
- **Deprovision / cleanup — REQUIRED whenever provisioning creates real infra.** For every resource, settle what
  a delete must **tear down** and where that teardown lives. If provisioning creates nothing durable (pure
  compute, name-combining, observe-only), say so and there's nothing to do. But **if it creates real infra**
  (k8s objects, a cloud stack, a SaaS record, a file/bucket) you **must** ship the matching teardown *in the same
  step as the provisioning* — a create-only resource orphans infra on delete and is a bug, not a v2. Deletion is a
  two-step lifecycle (deprovision the thing → delete the row); the seam is **mode-specific** (see the Phase-2 wiring
  below and [11-deprovisioning](reference/11-deprovisioning.md)). Also decide **retain-vs-hard-delete the row**
  (`AutoDeleteOnDeProvision`) and any **cascade guard** (`ValidateCanDeprovisionAsync` — block delete while
  children exist). Include the teardown in the shape you present for approval, not as a follow-up.
- **Menu placement** — ask where it appears in the AI Suite left-nav (by **title**, never silently default to
  DevOps). Set `manifest.frontend.menus[]` (an array of menu trees, matched/created **by title** — see
  [08-parent-child-and-menus](reference/08-parent-child-and-menus.md)): a **new top-level group** named by the user
  (e.g. `Jenkins`, `GCP`), or **nest under an existing section** by making that section's title the tree root
  (e.g. `DevOps`), or **no menu** (omit `menus`). The user gives titles only — **you** generate each node's `id`
  (`<manifest.id>-<slug>`), its `relativeUrl`, and the matching `frontend.routes[]`. The `relativeUrl` and
  `routes[].path` **MUST** be `extensions/<feature>-<resource>` (same value, never `clouds/…`) — see
  [00-naming](reference/00-naming.md). Also settle **title** + **icon** per item.
- **One or many resources?** — an extension may ship several resources (one backend DLL + one FE remote): **flat**
  (independent — e.g. `GCP` → network/cluster/database) or **parent → child** (add a `parent` block; worked example
  `samples/parent-child`). It may also surface **multiple top-level menu groups** at once. See
  [08-parent-child-and-menus](reference/08-parent-child-and-menus.md).

**Present the settled shape for approval** (local: the plan you `ExitPlanMode` with; in-platform: the `Processing`
summary you post) **always as three things, not a prose blurb:** a **Spec** field table (name · type ·
required/optional), a **Result** field table (name · type), the chosen **provisioning mode** (Worker / Agent /
Passthrough / No-provision) **with a one-line reason**, the chosen **result-view shape** (Option A declarative
view-template for simple/static results, or Option B custom tabbed results — name the intended tabs, e.g.
Overview | Logs; see [17-custom-result-views](reference/17-custom-result-views.md)) **with a one-line reason**,
and a short **user-experience** walkthrough — left-nav placement, the add form, the list, the detail view
(Spec/Result panels + Track Provisioning Status), and what provisioning does end-to-end. Do this per resource
for multi-resource extensions.

**Where the answers come from / how to ask:**
- **In-platform:** read `spec.description`/`spec.icon` from `shared/extension.json`. If anything required is missing
  or ambiguous, POST status **`Blocked`** with a `blockedReason` that lists the specific questions (and post the
  same as a ticket chat message), then **stop** — do not scaffold. On the next invocation re-read
  `shared/extension.json` + the latest chat reply and proceed **only** once every required item is unambiguous.
  Once clear, POST `Processing` and continue (Phase 6 shows the curl).
  ```bash
  curl -fsS -X POST "$RES/status" -H "Authorization: Bearer $DUPLO_TOKEN" -H "Content-Type: application/json" \
    -d '{ "status": "Blocked", "blockedReason": "Need before I can build: (1) menu placement — section id / \"top-level\" / none? (2) spec fields + types. ..." }'
  ```
- **Local:** ask the developer conversationally and **wait** for answers. Do not scaffold until clear.

## Phase 2 — scaffold from the template

Only enter Phase 2 once Phase 1's gate has passed (every required item unambiguous). Set
`manifest.frontend.menus[]` to the placement the user chose (by title) — do **not** copy the template's example
menu blindly.

In a **clone-and-own repo** (you cloned the dev-kit and adopted it via `scripts/change_git_owner.sh`, or
`scripts/init-project.sh`), each extension lives in its own **`extensions/<name>/`** dir (a repo can hold many — add
another `extensions/<name2>/` for a second extension). Scaffold from the bundled template (skip if a starter was
already seeded — then just adapt what's there). Build a single extension with `scripts/build-extension.sh extensions/<name>`,
or all with `scripts/build-all.sh`:
```bash
[ -d "extensions/<name>" ] || cp -r "$(dirname "$0")/templates/helloworld" "extensions/<name>"
```
(In-platform inside a provisioning ticket, scaffold into the ticket workdir instead — same steps, different dir.)

Adapt inside `extensions/<name>/` (rename `HelloWorld`→`<Name>` consistently **across backend AND frontend** —
the build fails on leftover `HelloWorld`/`HelloService`/`hw-` identifiers). Per the
[authoring guide](reference/02-authoring-guide.md):
- `backend/HelloWorld.cs` — your `Spec`/`Result` fields; entity `[BsonCollection("extension_<entity>")]` (the
  lowercased entity name, e.g. `extension_helloworld` — NOT derived from the namespaced restSegment; see
  [00-naming](reference/00-naming.md)), `GetTicketOriginType()`/`GetTicketOriginSubType()`. Use the SDK base classes
  ([03-base-classes](reference/03-base-classes.md)); override hooks only if needed
  ([04-hooks](reference/04-hooks.md)).
- `backend/HelloWorldController.cs` — `: ResourcesController<…>` at `[Route(".../environment/<restSegment>")]`
  (the FULL namespaced `extensions/<feature>-<resource>`). **Name the class `<Name>Controller` (singular) to match
  the file `<Name>Controller.cs`** — the manifest does not reference the controller type, so this is purely a
  naming convention; keep it consistent. Add custom endpoints per [05-custom-actions](reference/05-custom-actions.md).
- `backend/Duplo.Extension.HelloWorld.csproj` — rename to `Duplo.Extension.<Name>.csproj` (keep the SDK
  PackageReference `ExcludeAssets="runtime"` + `nuget.config`).
- `frontend/src/app/*` — list/add/view for your fields. **Set the service's `REST_SEGMENT` to the FULL namespaced
  `extensions/<feature>-<resource>` (== manifest `restSegment`; a bare leaf 404s).** **Rename every FE
  `Hello`/`hw` identifier to your resource** (files, `HelloService`/`HelloWorld`, `Add/List/ViewHelloComponent`,
  `hw-*` selectors, `extension.routes.ts` routes, and a unique `federation.config.js` `name`) — see the FE
  rename table in [02-authoring-guide](reference/02-authoring-guide.md#frontend-optional-but-recommended).
  **Match the platform resource pattern** (network-baselines / TFDeployment) with
  `@duplocloud-internal/ng-common-lib`: `searchable-datatable` list; **`panel-form-accordion` + `form-field`**
  add/edit; detail = `view-header-card` (avatar-badge title) + **`app-flat-status-filter` Spec/Result toggle** +
  `@switch` + a footer with `subStatus`
  (the "Track Provisioning Status" button is **Agent-mode only** — see the mode wiring below).
  **The Result panel's body is the decision settled in Phase 1**: simple/static result → the declarative
  `app-resource-template-view` vendored from `samples/helloworld` (Option A,
  [09-result-templates](reference/09-result-templates.md)); complex result (live state, logs, actions, charts)
  → a custom `ngbNav` tab strip with per-tab panel components (Option B,
  [17-custom-result-views](reference/17-custom-result-views.md); worked example `samples/network-stack`).
  The scaffold ships plain hand-written result markup — replace it with the chosen option. **Share the lib's DI peer packages** (`@ngx-translate/core`, `@ng-bootstrap`,
  `@ng-select`, `@swimlane/ngx-datatable`, `@angular/cdk`/`material`, `ngx-toastr`/`markdown`/`monaco-editor-v2`)
  as **Native Federation singletons** in `frontend/federation.config.js` — else lib components throw
  `NullInjectorError`. That shared list is a **subset** of `duplo-ui/portal/federation.shared.js`, never a copy
  of it: share only packages your own `frontend/package.json` declares, or `requiredVersion: 'auto'` throws at
  config load. Build with a strict `npm install`; never fall back to npm's legacy peer-dependency flag.
  Reach the host via `REMOTE_DuploHttpClient` + `REMOTE_UserSession`; expose `./Extension`.
  Full guidance: [02-authoring-guide](reference/02-authoring-guide.md#frontend-optional-but-recommended) +
  [09-result-templates](reference/09-result-templates.md).
- `manifest.json` — `id`, `version`, `backend.{assemblyDir=<id>/<version>/backend, entryAssembly}`,
  the single `resources[]` entry (`archetype:"typed"` — **not** `skill-based`, `registrar:"DevOpsResource"`,
  + the five FQ type names), `skills`/`skillMappings` (**Agent mode only** — omit/empty for Worker/Passthrough/
  No-provision), `frontend`.

### Wire the chosen provisioning mode (the helloworld template is AGENT-shaped — convert it)
The `helloworld` template ships an Agent-mode skill. After picking the mode in Phase 1, make the backend match it
— **a missing piece silently falls back to Passthrough and create fails with "no skill mapping and does not
implement ProvisionDirectAsync".** Do **all** items for the chosen mode. **Each mode has a mandatory deprovision
seam** — wire it in the same pass as provisioning (a create-only resource orphans infra on delete); see
[11-deprovisioning](reference/11-deprovisioning.md):
- **Worker** (scaffold the extra pieces from [`samples/worker-compute`](../../../samples/worker-compute), not helloworld):
  1. service overrides `protected override ProvisioningMode NoSkillsFallbackMode => ProvisioningMode.Worker;`
  2. add `<Name>Worker : ResourceWorkerBase<<Name>,<Name>Spec,<Name>Result>` — `ApplyAsync` does the work + sets
     `entity.Result` + `await SaveProgressAsync(scope, entity, "...", ct)`. **Deprovision seam (required):**
     `DeleteSubResourcesAsync` must delete every object `ApplyAsync` created, in **reverse dependency order**, and
     `WaitForDeletionAsync` polls until they're gone. These are **no-ops / `=> true` ONLY for pure compute** that
     created nothing durable (`samples/worker-compute`); for real infra implement them (`samples/worker-appstack`
     deletes Service then Deployment) or you orphan objects on delete.
  3. add an `IDuploExtension` whose `Configure` calls `builder.Services.AddHostedService<<Name>Worker>();`
  4. **delete** the `skills/` dir and ship **no** `skills`/`skillMappings` in the manifest.
  5. **FE: remove the "Track Provisioning Status" UI** — no *provisioning* ticket exists in Worker mode, so the
     footer "Track Provisioning Status" button, the header "View Provisioning Ticket" `#actions` link, the
     list-row "Track Provisioning" item, and the `track()`/`ticketName()` methods are dead UI. Delete them and
     label the add button **"Create"** (not "Provision"). (If the user explicitly requested Ask AI sessions,
     those are unaffected — they need no provisioning ticket; just make `resolveAgentId()` go straight to
     `/models/allowed`. See [16-ask-ai](reference/16-ask-ai.md).)
- **Agent**: keep `skills/provision-*/SKILL.md` (+ `provision.sh`, write to the OWN route) and the manifest
  `skills` + `skillMappings`. **Keep** the "Track Provisioning Status" UI (Agent mode is the only mode with a
  trackable ticket). (If Ask AI was explicitly requested, its agent id comes from the provisioning ticket's
  `aiAgentId` — see [16-ask-ai](reference/16-ask-ai.md).) **Deprovision seam (required if it creates real infra):** on delete the platform reuses the
  SAME ticket and sends the generic *"Deprovision this resource. Tear down all infrastructure managed by this
  resource."* — there is **no separate deprovision skill mapping**, so the teardown must live in a skill already in
  `skillMappings.skillNames`. Give the provision `SKILL.md` a **Deprovision** section that reacts to that message
  and ship a deterministic idempotent `deprovision.sh` that deletes exactly what `provision.sh` created (see
  `samples/network-stack/skills/provision-network-stack`), or add a second `deprovision-*` skill to the same `skillNames`.
  Once your skill POSTs `{"status":"DeProvisioned"}`, the platform **auto-hard-deletes the row by default**
  (`AutoDeleteOnDeProvision` defaults `true` for agent) — override `AutoDeleteOnDeProvision => false` only to retain
  it for audit. (helloworld combines names only — nothing to tear down — so it ships no deprovision path; that's the
  exception, not the pattern.)
- **Passthrough**: override `ProvisionDirectAsync`/`UpdateDirectAsync`/**`DeprovisionDirectAsync`** (the required
  deprovision seam — delete the external object synchronously; passthrough defaults `AutoDeleteOnDeProvision => true`
  so the row vanishes with it); delete `skills/`; no `skillMappings`; **remove the Track-Provisioning UI**
  (no provisioning ticket — same as Worker; user-requested Ask AI sessions, if any, are unaffected — see
  [16-ask-ai](reference/16-ask-ai.md)). (See `samples/passthrough-configmap`.)
- **No-provision**: `IsProvisioningNeeded => false`; delete `skills/`; no `skillMappings`; **remove the
  Track-Provisioning UI** (no provisioning ticket — same as Worker; user-requested Ask AI sessions, if any,
  are unaffected — see [16-ask-ai](reference/16-ask-ai.md)).

## Phases 3–5 shortcut (clone-and-own repo)

If you're in a cloned dev-kit repo, **`./scripts/build-extension.sh extensions/<name>`** (or `./scripts/build-all.sh`
for every extension) does Phases 3–5 in one step
(fetch + pin the SDK, `dotnet publish`, `npm install && npm run build`, assemble
`extensions/<name>/dist/extension.zip`). It also **trims the bundle to your extension's own assemblies** (see Phase 5 —
the host already has the whole SDK closure loaded) so the upload stays small. The manual steps below are the
equivalent — use them in-platform or when there's no script. After it succeeds, skip to Phase 6.

## Phase 3 — fetch the host SDK feed (pin the exact version)

```bash
# Capture then validate (don't pipe straight to jq — a redirect/error page yields a cryptic jq parse error).
# -L follows http→https redirects.
SDK_RESP=$(curl -fsSL -H "Authorization: Bearer $DUPLO_TOKEN" "${DUPLO_BASE:-$DUPLO_HOST}/v1/aiservicedesk/extensions/sdk-version")
SDK_VER=$(printf '%s' "$SDK_RESP" | jq -r '.version // empty')
[ -n "$SDK_VER" ] || { echo "Bad sdk-version response (is DUPLO_HOST the studio base URL, reachable, https?): $SDK_RESP" >&2; exit 1; }
curl -fsSL -H "Authorization: Bearer $DUPLO_TOKEN" "${DUPLO_BASE:-$DUPLO_HOST}/v1/aiservicedesk/extensions/sdk-bundle" -o /tmp/sdk.zip
unzip -o /tmp/sdk.zip -d extensions/<name>/backend/sdk-packages
```
Write `$SDK_VER` into `manifest.json` `sdkVersion` (the loader rejects a mismatch — see
[06-registration](reference/06-registration.md#sdk-version-pinning--why-exactness-matters)).

## Phase 4 — build backend + frontend

```bash
( cd extensions/<name>/backend && dotnet publish Duplo.Extension.<Name>.csproj -c Release -o ../dist/backend -p:DuploSdkVersion="$SDK_VER" )
( cd extensions/<name>/frontend && npm install && npm run build )
```
Use a plain **`npm install`** — installs are strict, exactly like the host portal. Never loosen it with npm's
legacy peer-dependency flag. Where a dependency has no Angular 22 release (`ngx-toastr`, at time of writing),
the frontend's `package.json` pins it with an `overrides` block rather than loosening the whole install. If a
new conflict appears, add an override — do not restore the flag. The frontend
gets `@duplocloud-internal/ng-common-lib` from the **vendored tarball** committed at
`frontend/vendor/*.tgz` (referenced via `file:` in `package.json`), which npm resolves off disk without
contacting a registry — so **no registry config and no auth token are needed** (see
[02-authoring-guide.md](reference/02-authoring-guide.md#install-vendored-tarball--no-registry-no-token)).
The SDK is compile-only, but
`dotnet publish` still copies the SDK's whole **transitive** closure (Duplo.Ai.*, Mongo, AWS, AspNetCore,
and ~33 MB of native `runtimes/`) into `dist/backend` — the host already has all of it loaded and resolves
it for you, so only your own DLL(s) belong in the bundle (Phase 5 strips the rest; shipping it trips HTTP
413 on load-bundle). `frontend/dist` has `remoteEntry.json` (the Native Federation entry) plus its sibling ESM
chunk files — ship the whole directory. Run each command in its own subshell
`( cd <abs-or-ticket-relative> && … )` so a failed `cd` can't strand later commands in the wrong directory.

## Phase 5 — assemble the bundle

Zip ROOT = `manifest.json` + `backend/` (your DLL only) + `fe/` (FE dist) + `skills/`:
```bash
PKG=extensions/<name>/dist/pkg; rm -rf "$PKG"; mkdir -p "$PKG/backend" "$PKG/fe" "$PKG/skills"
cp    extensions/<name>/manifest.json   "$PKG/manifest.json"
# Ship ONLY your extension's own assemblies — NOT dist/backend/* (that's the full SDK closure the host
# already provides) and NOT runtimes/ (host-provided natives). Copying everything trips HTTP 413 on upload.
cp    extensions/<name>/dist/backend/Duplo.Extension.*.dll "$PKG/backend/"   # + any extra third-party DLL your csproj adds beyond the SDK
cp -r extensions/<name>/frontend/dist/* "$PKG/fe/"
cp -r extensions/<name>/skills/*        "$PKG/skills/"
# Result view-templates (optional) — ship at the bundle root so the loader registers them (see 09-result-templates):
[ -d extensions/<name>/resources-frontend-templates ] && \
  cp -r extensions/<name>/resources-frontend-templates "$PKG/resources-frontend-templates"
rm -f extensions/<name>/dist/extension.zip   # zip updates in place — drop the stale archive so the bundle actually shrinks
( cd "$PKG" && zip -r ../extension.zip . )
```

## Phase 6 — load (mode-specific) + write back

**In-platform** (resource-scoped token; `RES=${DUPLO_BASE:-$DUPLO_HOST}/v1/aiservicedesk/user/data/workspaces/<ownerWorkspaceId>/environment/extensions/<id>`):
```bash
curl -fsS -X POST "$RES/load-bundle" -H "Authorization: Bearer $DUPLO_TOKEN" \
  -H "Content-Type: application/zip" --data-binary @extensions/<name>/dist/extension.zip
curl -fsS -X POST "$RES/status" -H "Authorization: Bearer $DUPLO_TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "Complete", "subStatus": "Extension loaded" }'
```
**Local** (admin token) — in a clone-and-own repo just use the script (reads the target from `.env`/env):
```bash
./scripts/deploy-extension.sh extensions/<name>/dist/extension.zip
```
Equivalent raw call:
```bash
curl -fsS -X POST "${DUPLO_BASE}/v1/aiservicedesk/admin/extensions/load-bundle" \
  -H "Authorization: Bearer $DUPLO_TOKEN" -H "Content-Type: application/zip" \
  --data-binary @extensions/<name>/dist/extension.zip
```
On failure, capture the endpoint's error body (e.g. SDK-version mismatch, missing entry assembly); in
in-platform mode POST status `Failed` with a `faults` array.

## Phase 7 — verify

- **In-platform:** the `load-bundle` response already confirms success — it returns the loaded record
  with `result.addedResource` (originType, restSegment, remoteEntry) + `skillNames`. Treat a 200 there
  as the verification, then POST status `Complete`. **Do NOT** try to `GET …/environment/<restSegment>`
  with the resource-scoped `$DUPLO_TOKEN` — that token is not authorized for arbitrary routes and will
  return 403/404 even though the extension loaded fine.
- **Local (admin token):** you may confirm the live route directly: `GET …/environment/<restSegment>` → 200,
  and `GET …/admin/extensions` lists it. Create one → it persists to `extension_<restseg>`, fires a provisioning
  ticket, your skill runs and fills the Result. (Teardown: `DELETE …/admin/extensions/{id}` → route withdraws live.)

## Reference

- Worked example: [`./templates/helloworld/`](templates/helloworld/) — typed backend + remote + skill + manifest.
- Typed extension shape in-repo: `tests/Duplo.Extension.Fixture/`.
- Full framework docs: [`reference/`](reference/) (architecture, base classes, hooks, custom actions, registration).
