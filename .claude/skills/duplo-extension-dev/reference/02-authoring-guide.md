# Authoring Guide — the common path

How to build a platform extension in practice. This is the 20% you need; the full reference is in
[03-base-classes.md](03-base-classes.md) and [04-hooks.md](04-hooks.md).

## The five classes + one controller

For a top-level resource you write (rename `HelloWorld` to your resource):

| File | Class | Base | You implement |
|---|---|---|---|
| `backend/HelloWorld.cs` | `HelloWorldSpec` | `BaseSpec` | your input fields |
| | `HelloWorldResult` | `BaseResult` | your output fields |
| | `HelloWorld` | `ResourceBase<Spec,Result>` | `[BsonCollection("extension_…")]`, `GetTicketOriginType()`, `GetTicketOriginSubType()` |
| | `HelloWorldHooks` | `DefaultEntityHooks<>` (or `ResourceHooksBase<>`) | nothing, or `GetImmutableSpecFields`/`GetDeletableStatuses` |
| | `HelloWorldService` | `ResourceServiceBase<Entity,Spec,Result>` | usually nothing (ctor only) |
| `backend/HelloWorldController.cs` | `HelloWorldsController` | `ResourcesController<Entity,Spec,Result>` | just the `[Route]` |

The skeleton is in [03-base-classes.md](03-base-classes.md#minimal-typed-resource-what-a-extension-ships)
and shipped as the hello-world template. That alone is a complete first-class resource — CRUD,
`status`/`results`, deprovision, view-template, and the provisioning lifecycle, with no boilerplate.

## Choose how it provisions

- **Agent-based (recommended, default for extensions):** map a skill to `originType/subType` in the
  manifest's `skillMappings`. On create, the platform opens a ticket; your skill reads
  `shared/<subtype>.json`, does the work, and writes back via `POST {id}/results` + `{id}/status`. Override
  nothing in the service. (See the hello-world `skills/provision-helloworld/SKILL.md`.)
- **Synchronous (passthrough):** no skill — override `ProvisionDirectAsync`/`UpdateDirectAsync`/
  `DeprovisionDirectAsync`, set `Status=Complete` and populate `Result` inline.
- **Background (worker):** return `Worker` from `NoSkillsFallbackMode` for continuous reconcile + drift.

## Which hooks you'll actually override

Most extensions override none. When you do, the usual ones:

- `ValidateSpecAsync` — validate your spec fields.
- `ValidateAsync` — entity/name rules (call `base` first).
- `EnrichResultAsync` — show live cloud state on view (see [05-custom-actions.md](05-custom-actions.md)).
- `OnAfterStatusUpdateAsync` / `OnAfterResultUpdateAsync` — react to lifecycle transitions.
- `GetImmutableSpecFields` / `GetDeletableStatuses` (in `ResourceHooksBase`) — freeze fields / gate delete.

Decision table: [04-hooks.md](04-hooks.md#which-to-override--quick-guide).

## Resource-group-scoped (env-child) resources

If your resource lives **under a Resource Group** (like a Kubernetes `Namespace`), use the DevOps
variants instead: entity `: ResourceGroupRef<Spec,Result>`, spec `: ResourceGroupSpecRef`
(adds `EnvironmentId`+`ResourceGroupId`), service `: ResourceGroupChildServiceBase<,,>`, controller
`: ResourceGroupControllerRef<,,>`. The service auto-derives `ScopeIds` from the parent RG and enriches
the agent spec with `ResourceGroupContext`. (First-party reference: the in-repo
`env-child-resource-provisioning` skill.)

## The manifest (`manifest.json`)

Ties the bundle together. For a typed extension (see the hello-world manifest):

```jsonc
{
  "manifestVersion": "1.0",
  "id": "duplo.examples.helloworld", "name": "Hello World", "version": "0.1.0",
  "sdkVersion": "<from GET …/extensions/sdk-version>",
  "backend": { "assemblyDir": "duplo.examples.helloworld/0.1.0/backend",
               "entryAssembly": "Duplo.Extension.HelloWorld.dll" },
  "resources": [{
    "ticketOriginType": "HelloWorld", "restSegment": "extensions/helloworlds", "subType": "hello-world",
    "archetype": "typed", "registrar": "DevOpsResource",
    "entityType": "Duplo.Extension.HelloWorld.HelloWorld",
    "specType":   "Duplo.Extension.HelloWorld.HelloWorldSpec",
    "resultType": "Duplo.Extension.HelloWorld.HelloWorldResult",
    "hooksType":  "Duplo.Extension.HelloWorld.HelloWorldHooks",
    "serviceType":"Duplo.Extension.HelloWorld.HelloWorldService"
  }],
  "skills": [{ "folder": "duplo.examples.helloworld/0.1.0/skills/provision-helloworld", "isBuiltIn": true }],
  "skillMappings": [{ "originType": "HelloWorld", "subType": "hello-world",
                      "skillNames": ["provision-helloworld"], "timeout": { "provision": 300, "deprovision": 120 } }],
  "frontend": { "remote": { … }, "menus": [ … ], "routes": [ … ] }
}
```
Critical: `archetype` must be `"typed"` (not `"skill-based"`) so the loader takes the DLL path; the five
`*Type` names must be the fully-qualified type names in your DLL; `backend.assemblyDir` is
`<id>/<version>/backend`.

### Naming convention — never collide with the platform or other extensions

> **Canonical rule lives in [00-naming](00-naming.md) — that file is authoritative; the build gate enforces it.**
> The summary below must stay consistent with it.

An extension's resources share the platform's runtime (routes, Mongo db, ticket origin types). Pick names that
are **collision-free by construction** — the platform does NOT auto-namespace them for you:

- **Mongo collection** (`[BsonCollection("…")]`): prefix with `extension_` → `extension_<entity>` (lowercase),
  e.g. `extension_tfstate`. Never reuse a built-in collection name.
- **REST segment / API path** (`restSegment` + your controller `[Route]`): namespace the API under
  `extensions/` and use a descriptive name → `…/environment/extensions/<feature>-<resource>` (e.g.
  `…/environment/extensions/terraform-states`), never the built-in's flat segment (`tfstates`). The controller
  `[Route]` must match this path exactly. (`…/environment/extensions/…` is reserved for customer extensions; the
  platform's own Extension-Studio authoring resource lives at `…/environment/extension-studio`, so it won't
  shadow your `extensions/<…>/{id}` routes.)
- **Frontend route + menu** (`frontend.routes[].path`, `frontend.menus[].relativeUrl`): namespace under
  `extensions/` → `extensions/<feature>-<resource>` (mounts at `/ai/suite/{tenant}/extensions/…`). Do NOT reuse
  the built-in `clouds/…` route paths — the host registers built-in routes first, so a duplicate `clouds/…`
  path silently resolves to the built-in module (your pages show the wrong/old data).
- **Ticket origin type** (`ticketOriginType` + the entity's `GetTicketOriginType()`): a descriptive PascalCase
  string distinct from any built-in — e.g. `TerraformState`, not `TfState`. `subType` can be feature-specific.
- **C# namespace**: `Duplo.Extensions.<Feature>` (class names can stay conventional; the namespace disambiguates).
- **Skill callbacks** must POST to the extension's `extensions/<…>` API path (keep them in sync with the
  controller `[Route]` / manifest `restSegment`).
- **Skill callbacks**: any `…/environment/<segment>/{id}/results|status|…` URL the skill's scripts/phase-docs
  POST to MUST use the extension's `restSegment` (not a built-in's) — otherwise status/result callbacks hit the
  wrong controller. Keep the skill's hardcoded segments in sync with the manifest.

(While a built-in feature with the same purpose still ships, this is also how you avoid an ASP.NET
`AmbiguousMatchException` on duplicate routes and duplicate origin-type/skill mappings.)

### `frontend.menus[]` — where the extension appears in the left-nav

`menus` is an **array of menu trees**; each node is `{ id, title, type, matIcon|icon, relativeUrl?, order?, children?[] }`.
The portal find-or-creates each node in the nav **by title** (case-insensitive), recursing into `children`. Placement
is chosen explicitly per extension (the `duplo-extension-dev` skill asks the user — there is no silent default):
- **A new top-level group** — a tree whose root title doesn't exist yet (e.g. `Jenkins`, `GCP`); use
  `type: "collapsible-section"` with `item` children.
- **Nest under an existing section** — make that section's **title** the tree root (e.g. `DevOps`,
  `Infrastructure`); the existing item is reused and your children appended. Title is the only key — never a
  `parentGroupId`/id.
- **No menu** — omit `menus`. The extension loads and its routes are live, but nothing renders in the nav.

The author supplies titles only; **you (the agent) fill** each node's `id` (`<manifest.id>-<slug>`), each leaf's
`relativeUrl`, and the matching `frontend.routes[]` entry — every `relativeUrl`/`path` namespaced under
`extensions/` ([00-naming](00-naming.md)). One extension may contribute several top-level groups.

> Legacy `frontend.menu = { parentGroupId, node }` (single, id-matched) still loads for back-compat but is
> **deprecated** — new extensions MUST use `menus[]`.

## Build, package, load

The `duplo-extension-dev` skill (`../SKILL.md`) does this — both inside a Extension provisioning ticket and on
your local machine:

1. `GET …/extensions/sdk-version` → pin; `GET …/extensions/sdk-bundle` → unzip to `backend/sdk-packages`.
2. `dotnet publish backend -c Release -o dist/backend -p:DuploSdkVersion=<ver>` (SDK is compile-only).
3. `(cd frontend && npm install && npm run build)` → `frontend/dist/remoteEntry.json` + its ESM chunks.
4. Zip `{manifest.json, backend/, fe/, skills/}`.
5. **Load:** in-platform → `POST …/extensions/{id}/load-bundle` (scoped token); local → `POST …/admin/extensions/load-bundle` (admin token).

Then the new resource's route is live: `GET …/environment/<restSegment>` → 200, and it appears in the menu.

## Frontend (optional but recommended)

Ship an Angular **Native Federation** remote (list/add/view) and **use the platform UI library
`@duplocloud-internal/ng-common-lib`** so your pages match the rest of the suite — don't hand-roll tables,
forms, or view layouts. Reach host services via the string DI tokens `REMOTE_DuploHttpClient` and
`REMOTE_UserSession` (`workspaceId = session.tenant.TenantId`), call your own route
`…/environment/<restSegment>`, and expose a `Routes` array as `./Extension` (the host's registrar hands it
straight to `loadChildren`, which accepts routes or an NgModule).

**Component shape** — the full ruling, with the per-API catalogue, is the [`use-ng22`](../../use-ng22/SKILL.md)
skill; load it before writing frontend code. In short: standalone components that declare their own
`imports`, with **no `changeDetection` property** and all async state in `signal()`. Angular 22 defaults a component with no strategy to `OnPush`,
so a plain field assigned from a `subscribe` never repaints — the build stays green and the list just sits
empty. A signal write marks the view dirty, which is what makes the default correct instead of a trap. Use
`inject()`, `input()`/`computed()`/`viewChild()`, and the `@if`/`@for`/`@switch` block syntax. `helloworld`
is the worked reference; importing an NgModule (`SearchableDatatableModule`, `SharedFormsModule`,
`CommonLibComponentsModule`) from a standalone component's `imports` is fine and is how the lib is consumed.

**Toolchain** — match the host portal; a major skew from it degrades singleton sharing (with
`strictVersion: false` Native Federation still resolves one copy, but logs a version warning). Angular
`^22.1.0`, TypeScript `6.0.3`, npm `>= 10.9.0`, and Node on Angular 22's supported line
(`^22.22.3 || ^24.15.0 || >=26.0.0` — the host portal's `package.json` still declares `>= 22.12.0`, which is
Angular 21's floor; don't copy that number). The remote is built by
`@angular-architects/native-federation` from `frontend/federation.config.js`; there is **no standalone dev
server** — no `serve` target, no `index.html`, no `bootstrap.ts`. The loop is **build → deploy → hot-load**
(`scripts/build-extension.sh` + `scripts/deploy-extension.sh`), and you see your pages inside the real portal.
In `angular.json`, set `outputPath` to `{ "base": "dist", "browser": "" }` — Angular 22 otherwise emits into
`dist/browser/`, which breaks the bundle layout (`build-extension.sh` copies `frontend/dist/.` straight into
`fe/`) and is rejected by `verify-remote-federation.js`.

> ⚠️ **The FE `REST_SEGMENT` MUST be the FULL namespaced segment — `extensions/<feature>-<resource>` — and equal
> the manifest `resources[].restSegment` and the controller `[Route]`.** It is NOT a bare leaf. The service builds
> `…/environment/${REST_SEGMENT}`, so a bare leaf 404s every list/get/create/view-template call. `build-extension.sh`
> fails the build if they don't match. (`origin-context`/`ticketName` use a different `/tickets/…` path — unaffected.)
> ```ts
> const REST_SEGMENT = 'extensions/widgets';   // == manifest restSegment == controller [Route]
> private base() { return `/v1/aiservicedesk/user/data/workspaces/${this.workspaceId()}/environment/${REST_SEGMENT}`; }
> ```

> **Rename the FE off the template, exactly as you rename the backend.** When you change the resource name you MUST
> also rename every frontend `Hello`/`hw` identifier (the build fails otherwise):
> | Template | Rename to |
> |---|---|
> | `hello.service.ts` | `<resource>.service.ts` |
> | class `HelloService` | `<Name>Service` |
> | interface `HelloWorld` | `<Name>` |
> | `add-/list-/view-hello.component.ts` + classes `Add/List/ViewHelloComponent` | `…<resource>.component.ts` + `Add/List/View<Name>Component` |
> | selectors `hw-add`/`hw-list`/`hw-view`/`hw-root` | `<slug>-add`/`<slug>-list`/`<slug>-view`/`<slug>-root` |
> | `federation.config.js` `name` (== manifest `frontend.remote.remoteName`) | unique `duploExtension<Name>` |
> Update the routes in `extension.routes.ts`, and each component's own `imports`, to the renamed classes.

**Match the platform resource pattern** (network-baselines / TFDeployment) so an extension's pages are
indistinguishable from a first-party resource. The worked reference is
`duplo-ui/portal/ai-studio/src/app/environment/network-baselines/`.

Use these library pieces (import from `@duplocloud-internal/ng-common-lib`):
- **List** → `SearchableDatatableModule` (`<searchable-datatable [rows]="rows" (add)="…" (filter)="filterUpdate()">`
  with projected `<ngx-datatable-column>` cells, an actions `ngbDropdown`, and a status badge). Two things the list
  component **MUST** do — a plain `[rows]` + `(add)` binding that loads once in `ngOnInit` is the #1 pair of bugs:
  - **Wire the filter.** `<searchable-datatable>` owns the search box and emits `(filter)` on each keystroke, but it
    does **not** filter — it renders whatever `[rows]` you hand it. So keep a full `allRows` backing array and recompute
    the shown `rows` yourself. Never bind `[rows]` to the raw fetch result with no `(filter)` handler (the box then does
    nothing):
    ```ts
    @ViewChild(SearchableDatatableComponent) private table?: SearchableDatatableComponent;
    rows: MyRes[] = []; private allRows: MyRes[] = [];
    private searchFields = ['name', 'status', 'spec.firstName'];   // string fields / dot-paths only (lodash get)
    filterUpdate(): void {
      const v = this.table?.searchTerm?.toLowerCase()?.trim();
      this.rows = v ? this.allRows.filter(r => FilterTableUtils.searchByFields(r, this.searchFields, v))
                    : this.allRows.slice();
    }
    ```
  - **Re-fetch on workspace switch.** Do NOT load only in `ngOnInit` — that never re-runs when the user switches
    workspace, so the list shows the old workspace's rows until a full page reload. Subscribe to the host session's
    `getTenantRefreshTimer(true)` (it emits `[tenant, tenantChanged]` on first load, on every workspace switch, and on
    the poll tick — no reload needed) and re-call your `list()` each time. Add `providers: [SubDestroyService]` and
    `takeUntil(this.destroy$)`:
    ```ts
    @Component({ …, providers: [SubDestroyService] })
    constructor(private svc: MyService, private destroy$: SubDestroyService,
                @Inject(REMOTE_UserSession) private session: any) {}
    ngOnInit(): void {
      this.session.getTenantRefreshTimer(true).pipe(takeUntil(this.destroy$))
        .subscribe(([, changed]: [any, boolean]) => this.refresh(!!changed));
    }
    private refresh(changed: boolean): void {
      if (changed) { this.table?.startLoading(); }
      this.svc.list().pipe(takeUntil(this.destroy$)).subscribe({
        next: rows => { this.allRows = rows || []; this.filterUpdate(); this.table?.refresh(); },
        error: () => { this.allRows = []; this.filterUpdate(); this.table?.stopLoading(); },
      });
    }
    ```
  `FilterTableUtils`, `SubDestroyService`, `SearchableDatatableComponent` import from `@duplocloud-internal/ng-common-lib`;
  `REMOTE_UserSession` is the same host token the FE service already injects. The worked reference is
  `duplo-ui/portal/ai-studio/src/app/environment/network-baselines/list-network-baselines/`.
- **Add / Edit** → the **`panel-form-accordion`** 3-column layout (title+description | inputs | per-field help).
  ⚠️ The column widths are a host **SCSS mixin** that each host component `@include`s — they are **NOT** global
  CSS, and the published lib ships compiled CSS only. So the remote must carry the column rules in its own
  component `styles` (Bootstrap utilities like `d-flex`/`justify-content-between` ARE global, but
  `.panel-content-title`/`.panel-content-form`/`.panel-content-sidenav` are not):
  ```scss
  .panel-content-title { width: 265px; min-width: 265px; }
  .panel-content-form  { max-width: 768px; flex: 1 1 auto; margin: 0 1rem; padding: 0 1rem; }
  .panel-content-sidenav { width: 265px; min-width: 265px; margin-left: 2rem; }
  ```
  Markup (all three columns — omitting the sidenav makes the title balloon):
  ```html
  <div class="card panel-form-accordion"><div class="d-flex justify-content-between">
    <div class="panel-content-title"><h4 class="font-weight-bolder">Create X</h4>
      <p class="panel-content-title-sub-text">…</p></div>
    <div class="panel-content-form">
      <form #f="ngForm" class="form form-vertical" (ngSubmit)="f.valid && submit()">
        <div class="form-container" form-group-errors #formGroupErrors showDetailsWhen="submitted">
          <form-field><label class="element-label">Name *</label>
            <input class="form-control" name="name" [(ngModel)]="name" required validation-state validation-errors></form-field>
          …
        </div></form>
    </div>
    <div class="panel-content-sidenav">   <!-- 3rd column: per-field help -->
      <div class="help-item"><p class="help-item-title">Name</p><small class="text-muted">…</small></div>
    </div>
  </div></div>
  ```
  `form-field` + `validation-state`/`validation-errors`/`form-group-errors` are from `SharedFormsModule`.
  **Template-driven only** (`ngForm` + `ngModel`) — no Reactive Forms. For multi-step forms, follow the
  **wizard polish checklist** in [14-forms-and-wizards](14-forms-and-wizards.md) — title/subtitle on the
  stepper, loading-aware selects, a complete Review step — so the form ships finished, not prototype-grade.
- **Detail view** → `ViewWithSidecardsComponent` + `ViewHeaderCardComponent` + `SidecardComponent`, with a
  **Spec/Result panel toggle** via `<app-flat-status-filter>` in `#headerFilter` (the OUTER switcher — keep
  it to panels like Spec | Result | Events, never feature tabs). Header `#title` is an avatar-badge + name in
  an `<h3>`; `#actions` are `ngbDropdownItem` links. The body is `@switch (activePanel())`, and a
  **footer** shows `subStatus` + (agent mode only — see below) a "Track Provisioning Status" button. `item`
  and `activePanel` are `signal()`s, so `@if (item(); as it)` unwraps the loaded resource once.
  **The Result panel's BODY forks** (decide per resource — see "Viewing the result" below): simple/static
  result → the declarative `<app-resource-template-view>` (Option A); anything richer → a custom **`ngbNav`
  tab strip inside the Result panel** with per-tab components (Option B,
  [17-custom-result-views](17-custom-result-views.md)):

  > **The "Track Provisioning Status" button + "View Provisioning Ticket" action are AGENT-mode only.** They open
  > the provisioning ticket's chat — which exists only when a skill is mapped. **Worker / Passthrough / No-provision
  > modes create no provisioning ticket**, so `ticketName()` returns null and the button is dead UI. For those modes,
  > OMIT the footer button, the `#actions` "View Provisioning Ticket" link, the list-row "Track Provisioning" item,
  > AND the `track()`/`ticketName()` methods (and label the add button **"Create"**, not "Provision"). Keep them only
  > for Agent mode. (Ask AI sessions — **opt-in**, built only on the user's explicit request — are
  > mode-independent and unaffected by this rule: they're user-created and never depend on a provisioning
  > ticket; see [16-ask-ai](16-ask-ai.md).)
  ```html
  @if (item(); as it) {
  <view-header-card [compactActions]="true">
    <ng-template #title><h3 class="text-uppercase mr-auto">
      <span class="badge avatar-badge">{{ it.name?.[0] }}</span><span class="name-badge">{{ it.name }}</span></h3></ng-template>
    <ng-template #actions><a ngbDropdownItem (click)="track()">View Provisioning Ticket</a></ng-template>
    <ng-template #headerFilter><app-flat-status-filter [filters]="panelFilters" [activeStatus]="activePanel()"
      [showCount]="false" (changed)="activePanel.set($event)"></app-flat-status-filter></ng-template>
  </view-header-card>
  <sidecard featherIcon="activity"><h6 class="card-subtitle text-muted">Status</h6>
    <h4 class="card-title"><app-status-badge [status]="it.status"></app-status-badge></h4></sidecard>
  <section class="card px-2 py-1">
    @switch (activePanel()) {
      @case ('spec') { <div>…spec cards…</div> }
      <!-- Option A (simple/static result): -->
      @case ('result') { <app-resource-template-view [template]="viewTemplate()" [data]="it"></app-resource-template-view> }
      <!-- Option B (complex result): an ngbNav tab strip instead — Overview | … | Logs (+ Ask AI last when
           opted in), per-tab panel components; see 17-custom-result-views + samples/network-stack -->
    }
    <div class="d-flex justify-content-end align-items-center px-1 pb-1 pt-50">
      @if (it.subStatus) {
        <span class="font-small-3 text-muted mr-75 text-truncate" [title]="it.subStatus">{{ it.subStatus }}</span>
      }
      <button class="btn btn-primary btn-sm" (click)="track()">Track Provisioning Status</button>
    </div>
  </section>
  }
  ```
  `panelFilters = [new FlatStatusFilter({name:'spec',label:'Spec'}), new FlatStatusFilter({name:'result',label:'Result'})]`.
- **View (result)** → a decision, not a default: the declarative renderer (`<app-resource-template-view>`)
  for simple/static results, OR a custom tabbed results section for everything else — see
  "Viewing the result" below.

> **Host-only components to VENDOR if you use them** (not in the published lib): the result renderer
> `app-resource-template-view` — only needed for Option A — (copy it from
> `samples/helloworld/frontend/src/app/result-template/`, decoupled to need only CommonModule + ng-bootstrap). The platform's
> `app-sub-status-display` injects a host-only `SUCCESS_REPORTER` token that can't resolve in a remote — **inline a
> simple `<span [title]="item.subStatus">` instead** (as the samples do). The status pill `status-with-style` is
> **NOT exported** by the lib's `CommonLibComponentsModule` either — using `<status-with-style>` renders a blank
> unknown element. Ship the tiny `app-status-badge` instead (copy `shared/status-badge.component.ts` from the
> sample and declare it in your module). Everything else above is importable from the lib.

### Install (vendored tarball — no registry, no token)
`@duplocloud-internal/ng-common-lib` is not published to a registry you can reach. Every frontend in this
repo installs it from a **committed tarball** via a `file:` specifier, and npm reads a `file:` dependency
straight off disk without contacting a registry — so **no `.npmrc` and no auth token are needed**;
a plain `npm install` just works from a fresh clone. Two schemes coexist:

- **The samples** share one copy at repo-root `packages/`, since they never leave this repo:
  ```json
  "@duplocloud-internal/ng-common-lib": "file:../../../packages/duplocloud-internal-ng-common-lib-0.2.0.tgz",
  ```
- **The skill template** (`templates/helloworld/frontend/`) keeps its **own** copy under `vendor/`, because it
  gets copied out to `extensions/<name>/` or a provisioning workdir and must stay self-contained:
  ```json
  "@duplocloud-internal/ng-common-lib": "file:vendor/duplocloud-internal-ng-common-lib-0.2.0.tgz",
  ```

Scaffolding from the template carries the tarball and the specifier with it — keep both when you copy.
Maintainers bump the version across every frontend with `scripts/refresh-common-lib.sh <new-tgz>` (see
[docs/UPGRADING-ng-common-lib.md](../../../../docs/UPGRADING-ng-common-lib.md)).

Add the lib's UI peers to `dependencies` alongside it — **every package you list in `shared` must be a declared
dependency here**, because that is where `requiredVersion: 'auto'` looks it up (see the next section):
`@ngx-translate/core`, `@ng-bootstrap/ng-bootstrap`, `@ng-select/ng-select`, `@swimlane/ngx-datatable`,
`ngx-toastr`, `ngx-markdown`, `ngx-monaco-editor-v2`, `@angular/cdk`, `@angular/material`,
`@ngbracket/ngx-layout` (`^22.0.1`), `ngx-echarts` (`^22.0.0`), `angularx-flatpickr` (`^8.1.0`) — plus `bootstrap`.
Pin them to the **same majors the host portal ships** (today `@ng-bootstrap/ng-bootstrap` ^21,
`@swimlane/ngx-datatable` ^25 — check `duplo-ui/portal/package.json`): they are shared singletons, and
`verify-remote-federation.js` reports a major mismatch against the host. `bootstrap` (^4.6.2) is the exception —
CSS-only, not in the host's shared list, and not federated at all.

### Native Federation sharing — share the lib's DI peer packages (avoids `NullInjectorError`)
Do **not** share `@duplocloud-internal/ng-common-lib` itself (the host bundles its own copy under a different
specifier, so it's bundled into your remote). **But you MUST share the lib's DI-providing peer packages as
singletons**, or the lib's components fail at runtime with `NullInjectorError: No provider for …` — because a
peer service provided by the host's `forRoot()` (e.g. `@ngx-translate/core`'s `TranslateService`) has a
different class identity than your remote's bundled copy. Sharing makes the remote use the host's instances.
The remote declares its shared set in `frontend/federation.config.js`. That set must be a **subset** of the
host's `duplo-ui/portal/federation.shared.js`, using the same options per entry — a **subset, not a mirror**,
for two reasons:
- **Share only packages your own `frontend/package.json` declares.** `requiredVersion: 'auto'` makes `share()`
  call `lookupVersion()`, which **throws at config load** for any package it can't find in your `package.json`.
  The host shares utilities an extension has no dependency on (e.g. `yaml`) — copy those across and the build
  dies before it starts.
- **Never share a package the host does not publish.** `verify-remote-federation.js` enforces remote ⊆ host, so
  a subset passes and a remote-only package is reported as a failure.

Give every entry its **own object literal**. Do NOT hoist a shared `const S = {…}` and reuse it: `share()`
shallow-copies the map and then **mutates each value in place** (stamping `requiredVersion`/`version`, deleting
`includeSecondaries`). With one reused object the first key stamps its version onto it, every later key then
sees `requiredVersion !== 'auto'` and skips its own lookup — so the remote ships Angular's version for
`ngx-toastr`, `@ng-bootstrap/ng-bootstrap` and the rest. `strictVersion: false` stops that being a hard failure,
which is exactly why it goes unnoticed.
```js
// frontend/federation.config.js
const { withNativeFederation, share, NG_SKIP_LIST } =
  require('@angular-architects/native-federation/config');

const REMOTE_NAME = 'duploExtensionMyThing';   // ← unique per extension (see 08-parent-child-and-menus)

module.exports = withNativeFederation({
  name: REMOTE_NAME,
  exposes: { './Extension': './src/app/extension.routes.ts' },
  shared: {
    ...share({
      // Angular + RxJS framework — must be a single instance across host + remotes.
      '@angular/core':              { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@angular/common':            { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@angular/forms':             { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@angular/router':            { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@angular/platform-browser':  { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@angular/cdk':               { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@angular/material':          { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      'rxjs':                       { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      // UI library peers that provide DI services / module-scoped providers.
      '@ng-bootstrap/ng-bootstrap': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@ngx-translate/core':        { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      'ngx-toastr':                 { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@ng-select/ng-select':       { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      '@swimlane/ngx-datatable':    { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      'ngx-markdown':               { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      'ngx-monaco-editor-v2':       { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      // ng-common-lib peers carrying DI services / forRoot config. CoreCommonModule imports plain
      // FlexLayoutModule, whose SERVER_TOKEN only .withConfig() provides — the host does that, so a
      // privately bundled copy here fails with NG0201 FlexLayoutServerLoaded.
      '@ngbracket/ngx-layout':      { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      'ngx-echarts':                { singleton: true, strictVersion: false, requiredVersion: 'auto' },
      'angularx-flatpickr':         { singleton: true, strictVersion: false, requiredVersion: 'auto' },
    }),
  },
  // `skip` REPLACES the built-in list, so NG_SKIP_LIST must be spread in explicitly — dropping it would
  // un-skip es-module-shims, zone.js and @softarc/native-federation*. The regex excludes @angular/cdk's
  // Node-only "./schematics" entry point, which cannot survive browser bundling. @ngbracket/ngx-layout/server
  // is the same class of entry — NF's secondary-entry-point expansion picks it up and it imports
  // @angular/platform-server, which a browser-only app does not install.
  skip: [...NG_SKIP_LIST, /\/schematics(\/|$)/, '@ngbracket/ngx-layout/server'],
});
```
`@ngbracket/ngx-layout`, `ngx-echarts`, and `angularx-flatpickr` are required here even though your extension's
own code never imports them — ng-common-lib's components reach their DI tokens transitively, and omitting any
of the three throws `NG0201` at runtime on every common-lib page.

Sub-path entries (`@angular/common/http`, `rxjs/operators`) from the old webpack list are deliberately absent —
Native Federation resolves secondary entry points through the parent package. `@angular/animations` is absent
because the host no longer ships it.

After building, check the remote against the host yourself — nothing in `build-extension.sh` runs it for you:
```bash
node scripts/verify-remote-federation.js extensions/<name> [path/to/host/remoteEntry.json]
```
It checks that `dist/remoteEntry.json` exists and is flat (no `dist/browser/`), that its `name` equals the
manifest's `remoteName`, that the exposed module is present, and — when given the host entry — that every shared
package the remote declares is published by the host at the same major.

Bootstrap 4 + the Vuexy theme are served globally by the host, so the remote ships no CSS. Build with a strict
`npm install` — never npm's legacy peer-dependency flag. Where a dependency has no Angular 22 release
(`ngx-toastr`, at time of writing), the frontend's `package.json` pins it with an `overrides` block rather than
loosening the whole install.

### Viewing the result — decide per resource: declarative template OR custom tabs

**The Result panel's rendering is a design decision the agent makes from the settled Result fields — never a
default.** Two options:

**Option A — the declarative view-template (simple, static results only).** Choose when every result field
fits the four field types (`single`/`multi`/`table`/`raw`) and the page needs no buttons, live fetches,
charts, or logs:
1. Ship `resources-frontend-templates/<Type>/<subType>.view-template.json` in your bundle (at the bundle root,
   next to `manifest.json`). The studio loader registers that directory, and your inherited
   `GET …/environment/<restSegment>/view-template?type=<Type>&subType=<subType>` endpoint serves it.
2. In your view component, fetch it and render via the vendored `ResultTemplateModule` (copy it from
   `samples/helloworld/frontend/src/app/result-template/`):
   ```html
   @if (viewTemplate(); as tpl) {
     <app-resource-template-view [template]="tpl" [data]="item()"></app-resource-template-view>
   }
   ```
The template is groups → typed fields addressing your result blob by dot-path (`result.fullName`, …), with
`hideWhen` and drill-down `details`. Full shape + a worked example: [09-result-templates.md](09-result-templates.md).
With Option A, keep a small fallback (e.g. lib view-cards or plain markup) for when no template is served.

**Option B — a custom tabbed results section (everything else).** Choose when the result carries live state,
executions/logs, actions, charts, or conditional sections: an `ngbNav` tab strip INSIDE the Result panel
(e.g. Overview | Network | Logs — plus Ask AI last when opted in), one standalone panel component per tab,
lazy-loaded via `ngbNavContent`, fed by custom controller endpoints. Full pattern + gotchas:
[17-custom-result-views.md](17-custom-result-views.md); worked example: `samples/network-stack`.

For action buttons (logs, etc.) see [05-custom-actions.md](05-custom-actions.md).

### Canvas renderers & ticket wrappers — render your own agent artifacts + add ticket actions
When your skill writes a canvas document (an artifact under `./canvas-documents/`), the platform opens it in the
chat canvas panel. To render it with **your own component** (instead of falling back to a plain file view), and
to add deployment-level action buttons, wrap the platform ticket and register a canvas renderer — **no host
change required**.

1. **Wrap the ticket.** Point your resource's `:id/ticket/:ticketId` route at your own wrapper component that
   composes the platform `<app-resource-ticket>` shell. Project action buttons into its `[ticket-actions]` slot:
   ```html
   <app-resource-ticket [ticket]="ticket" [resource]="resource">
     <button ticket-actions class="btn btn-sm btn-outline-primary" (click)="plan()">Plan</button>
   </app-resource-ticket>
   ```
   (Import `ResourceTicketModule` from the lib; read `ticket`/`resource` from `route.snapshot.data`.)

2. **Register a renderer** from the wrapper's `ngOnInit`. Inject the registry via the **`REMOTE_CanvasRendererRegistry`
   token** (the host owns the one instance; your remote bundles its own copy of the lib, so inject the token, not
   the class). Unregister on destroy so it only applies inside your ticket:
   ```ts
   import { Inject } from '@angular/core';
   import { CanvasRendererRegistry, REMOTE_CanvasRendererRegistry } from '@duplocloud-internal/ng-common-lib';
   // …
   constructor(@Inject(REMOTE_CanvasRendererRegistry) private registry: CanvasRendererRegistry) {}
   ngOnInit() {
     this.registry.register({
       id: 'myext:my-doc',                 // unique; re-register replaces
       title: 'My Preview',
       priority: 10,                       // >0 wins over platform built-ins
       match: a => !!a.id?.endsWith('my-doc.yaml'),
       component: MyPreviewComponent,      // your component (declared in MyPreviewModule)
       ngModule:  MyPreviewModule,         // module providing the component's deps (required for remotes)
     });
   }
   ngOnDestroy() { this.registry.unregister('myext:my-doc'); }
   ```

3. **Author the renderer component.** It receives the doc id + a content stream via the injected `CANVAS_DOC`
   token (not an `@Input` — the host mounts it through `ngComponentOutlet`):
   ```ts
   import { CANVAS_DOC, CanvasDoc } from '@duplocloud-internal/ng-common-lib';
   constructor(@Inject(CANVAS_DOC) private doc: CanvasDoc) {}
   ngOnInit() { this.doc.content$.subscribe(text => /* parse + render */); }
   ```

**Namespace your canvas filename** (`<feature>-<doc>.yaml`) so it can't collide with another extension; `priority`
is the explicit override knob if you intentionally replace a built-in renderer. Worked reference: the Terraform
extension's `tf-deployment-ticket` wrapper (registers `tf:extracted-environments` → its own
`ExtractedEnvironmentsPreviewComponent`).

Next: [05-custom-actions.md](05-custom-actions.md) · [09-result-templates.md](09-result-templates.md) ·
[17-custom-result-views.md](17-custom-result-views.md) · [06-registration.md](06-registration.md).
