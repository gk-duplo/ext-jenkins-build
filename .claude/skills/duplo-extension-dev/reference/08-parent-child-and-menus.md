# 08 — Parent/child resources + nested left-hand menus

An extension can ship **more than one resource type** in a single bundle (sharing one backend DLL + one FE remote),
either **flat** (independent resources — e.g. `GCP` → `network`, `cluster`, `database`) or linked as
**parent → child** (e.g. import a parent "Job" once, then submit many "Build" children under it). Each resource is
a separate entry in `manifest.resources[]`; add a `parent` block only for the child case, omit it for flat. It can
also surface **multiple top-level menu groups** at once (see `frontend.menus[]` below). This doc covers the backend
wiring, the manifest, and — the part that's easy to miss — **how resources surface in the frontend** (nested
left-hand-side menus, or a tab inside a parent's detail view).

> **Worked sample: [`samples/parent-child`](../../../../samples/parent-child/)** — `HelloParent` → `HelloChild`,
> end to end (two-resource backend, nested child controller, manifest `parent` link, and a parent view with a
> children tab built on the platform UI library). Copy and adapt it the way `helloworld` is copied for single
> resources.

## Backend: parent + child resource

A child resource's spec extends `ParentRefSpec<TParent>` instead of `BaseSpec`. That base adds one field,
`ParentId`, which the platform stamps from the nested route — the child always knows its parent.

```csharp
// Duplo.Ai.Model/.../DataContracts/Resource/ParentRefSpec.cs  (the base)
public abstract class ParentRefSpec<TParent> : BaseSpec where TParent : Entity {
    public string? ParentId { get; set; }   // stamped by the controller from the URL
}

// your child spec
public class HelloChildSpec : ParentRefSpec<HelloParent> {
    public string? Note { get; set; }
}
```

The child's controller extends `ChildResourceController<TChild, TParent, TSpec, TResult>` (instead of
`ResourcesController<>`). Its constructor takes `IEntityService<TParent> parentService`. **Override the base
`Create`** (don't add a second `[HttpPost]` — that collides with the inherited one and throws
`AmbiguousMatchException`). Stamp `Spec.ParentId` from the route, validate the parent, then create via
`Service.CreateAsync` and return 201 yourself — do **not** fall back to the base `Create`, because its
`CreatedAtAction(nameof(GetById), …)` can't build a Location for a NESTED route (`GetById` needs `{parentId}`
too) and would turn a successful create into a 400. (`CreateUnderParentAsync` exists on the base, but it calls
`Create` internally — so calling it from your `Create` override would recurse; do the create inline as below.)

```csharp
// Reference: Duplo.Ai.DataManagement/.../Controllers/User/Resource/ChildResourceController.cs
[ApiController]
[Route("v1/aiservicedesk/user/data/workspaces/{workspaceId}/environment/hello-parents/{parentId}/hello-children")]
public class HelloChildrenController : ChildResourceController<HelloChild, HelloParent, HelloChildSpec, HelloChildResult> {
    private readonly IEntityService<HelloParent> _parent;
    public HelloChildrenController(IEntityService<HelloChild> svc, IEntityService<HelloParent> parent,
                                   ILogger<HelloChildrenController> log) : base(svc, parent, log) { _parent = parent; }

    [HttpPost]
    public override async Task<IActionResult> Create([FromBody] HelloChild resource, CancellationToken ct = default) {
        if (resource?.Spec is null) return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", "Body required."));
        var parentId = RouteData.Values["parentId"]?.ToString();
        if (string.IsNullOrEmpty(parentId)) return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", "parentId required."));
        if (await _parent.GetByIdAsync(parentId, ct) is null)
            return NotFound(ApiResponse<object>.ErrorResult("Not found", $"Parent '{parentId}' not found."));
        resource.Spec.ParentId = parentId;
        resource.OwnerWorkspaceId = GetWorkspaceIdFromRoute();
        try {
            var created = await Service.CreateAsync(resource, ct);   // validates, fires provisioning
            return StatusCode(StatusCodes.Status201Created, ApiResponse<HelloChild>.SuccessResult(created, "Created"));
        } catch (ArgumentException ex) {
            return BadRequest(ApiResponse<object>.ErrorResult("Invalid request", ex.Message));
        }
    }
}
```
> Gotcha — **bump `manifest.version` on EVERY backend code change.** A re-`load-bundle` of the SAME version does not
> reliably pick up new code: the prior `AssemblyLoadContext` is only best-effort-unloaded (BSON serializers / MVC
> caches pin it), and old MVC routes can linger (→ `AmbiguousMatchException`). A new version stages a fresh
> `{id}/{version}/backend` dir and a fresh load context, so the new DLL actually runs. (Only frontend-asset / skill /
> view-template changes are safe to reload at the same version. For backend, bump the version — or restart the studio.)

Nested route shape: `…/environment/<parentSeg>/{parentId}/<childSeg>`. The child's own `service` can resolve the
parent's details by injecting `IEntityService<HelloParent>` — **both resources register into the same per-extension
DI container** (`ExtensionRegistrar.RegisterExtension` registers each resource's repo + service +
`IEntityService<>`/`IResourceService<>` aliases), so the child can read its parent during
`GetExpandedSpecForAgentAsync` (e.g. to pass the parent's external id to the provisioning skill).

**Cascade delete**: when the parent is deleted or de-provisioned, delete its children in the parent's entity hook
(`OnPostDeleteAsync` / `OnPostUpdateAsync` guarded on `Status == DeProvisioned`) — same pattern the env-child
resources use (see `.claude/skills/env-child-resource-provisioning/backend.md`).

## Manifest: two resources + the `parent` link

`manifest.json` carries **two `resources[]` entries**; the child declares a `parent` block
(`ExtensionManifest.cs` → `ExtensionResourceManifest.parent`):

```jsonc
"resources": [
  {
    "ticketOriginType": "HelloParent", "restSegment": "extensions/hello-parents", "subType": "hello-parent",
    "archetype": "typed", "registrar": "DevOpsResource",
    "entityType": "…HelloParent", "specType": "…HelloParentSpec", "resultType": "…HelloParentResult",
    "hooksType": "…HelloParentHooks", "serviceType": "…HelloParentService"
  },
  {
    "ticketOriginType": "HelloChild", "restSegment": "hello-children", "subType": "hello-child",
    "archetype": "typed", "registrar": "DevOpsResource",
    "parent": {                                  // ← links child to parent (nested under it)
      "ticketOriginType": "HelloParent",
      "routeSegment": "extensions/hello-parents",   // namespaced; MUST equal the parent's restSegment
      "idRouteParam": "parentId"                    // child controller route nests: .../extensions/hello-parents/{parentId}/hello-children
    },
    "entityType": "…HelloChild", "specType": "…HelloChildSpec", "resultType": "…HelloChildResult",
    "hooksType": "…HelloChildHooks", "serviceType": "…HelloChildService"
  }
]
```

Each resource still gets its own skill-mapping entry (origin/subType → skill).

## Frontend: how the child shows up

There are **two surfacing patterns** — pick by how tightly coupled the child is.

### Pattern A — nested left-hand-side menu via `frontend.menus[]` (title-based)
Declare menus as an **array of trees** under `frontend.menus`. Each node has a `title`, optional `matIcon`/`order`,
and either a `relativeUrl` (a leaf → a route) or `children[]` (a group). The portal find-or-creates each node **by
title** and recurses (`mergeExtensionMenuItems`/`upsertMenuNodeByTitle` in `src/app/menu/menu.ts`):

- A top-level tree whose title doesn't exist yet becomes a **new top-level group** (e.g. `Jenkins`, `GCP`).
- A tree whose **root title matches an existing section** (e.g. `DevOps`) **nests into it** — the existing item is
  reused and your children appended. Matching is case-insensitive on the displayed title; **never reference an
  internal `parentGroupId`/id** — title is the only key.
- One extension may contribute **several** top-level groups (just add more entries to `menus[]`).
- Two extensions adding a same-titled group share it (first creator wins the node; children merge, deduped by title).
- Use `type: "collapsible-section"` for a group with children and `type: "item"` for leaves (the shape the Vuexy
  sidebar renders reliably).

**You (the agent) fill the ids** — the author only gives titles. Generate a deterministic `id` per node
(`<manifest.id>-<slug(title-path)>`), set each leaf's `relativeUrl` to `extensions/<slug>` (namespaced — never
`clouds/…`; see [00-naming](00-naming.md)), and add a matching `frontend.routes[]` entry with the same path.

```jsonc
// manifest.json → frontend.menus : one tree per top-level title (here a new "Hello" group)
"menus": [
  { "id": "duplo.examples.helloworld-hello", "title": "Hello", "type": "collapsible-section",
    "matIcon": "package-variant", "order": 60,
    "children": [
      { "id": "duplo.examples.helloworld-hello-parents", "title": "Parents", "type": "item",
        "matIcon": "folder-outline", "relativeUrl": "extensions/hello-parents", "order": 1 },
      { "id": "duplo.examples.helloworld-hello-children", "title": "All Children", "type": "item",
        "matIcon": "file-outline", "relativeUrl": "extensions/hello-children", "order": 2 }
    ]
  }
]
```

> Legacy: a single `frontend.menu = { parentGroupId, node }` still loads (merged into a group by id) but is
> **deprecated** — new extensions MUST use `menus[]`.

Add matching `frontend.routes[]`, including the nested form so a child detail keeps its parent in the URL. Every
`path` is namespaced under `extensions/` (the FE may nest for breadcrumbs; the **backend** child route stays flat —
see [00-naming](00-naming.md)):
```jsonc
"routes": [
  { "path": "extensions/hello-parents", "resourceType": "HelloParent", "subType": "hello-parent" },
  { "path": "extensions/hello-parents/:parentId/hello-children", "resourceType": "HelloChild", "subType": "hello-child" },
  { "path": "extensions/hello-parents/:parentId/hello-children/:childId", "resourceType": "HelloChild", "subType": "hello-child" }
]
```
`extension-route-registrar.ts` injects these under `suite/:tenantId` at runtime (no host rebuild). A child
resolver recovers `:parentId` by walking `ActivatedRoute.params`.

### Pattern B — child inside the parent's detail view (tightly-coupled children)
Don't give the child its own menu entry. Instead, the parent's **view** component renders a tab of its children
with row links into the nested child route. Build the parent view from the platform UI library
(`@duplocloud-internal/ng-common-lib`): `view-with-sidecards` + `view-header-card` + an `ngbNav`, and render the
children tab with a `<searchable-datatable [rows]="children" (filter)="filterUpdate()">` whose row click routes to
`extensions/hello-parents/:parentId/hello-children/:childId` (see
[02-authoring-guide](02-authoring-guide.md#frontend-optional-but-recommended)). Wire the child tab's search box with
the same `filterUpdate()` + `FilterTableUtils.searchByFields` pattern as the List view (a bare `[rows]` makes the box
inert); the parent-view refresh already re-loads children on workspace switch. This mirrors the env-child
resources (Namespace → ConfigMaps as a tab; `.claude/skills/env-child-resource-provisioning/frontend.md`).
Cleaner breadcrumb, child never appears "loose" in the nav.

**When to use which:** independent/often-browsed children → **A** (nested menu). Children that only make sense in
the parent's context (a build under a job, a config under a namespace) → **B** (tab in parent view). You can do
both — a nested menu *and* a child table in the parent view.

## Frontend remote identity — REQUIRED for multi-extension installs
Every extension's Native Federation remote must declare a **globally unique `name`** — unique across every
extension installed on the same platform, not just within your repo. Two extensions both scaffolded from the
template keep the template's `name` and collide: the host's `extension-route-registrar` calls
`loadRemoteModule({ remoteEntry, exposedModule })`, and Native Federation reads the `name` out of the fetched
`remoteEntry.json` and registers the remote **by that name** — so distinct `remoteEntry` URLs do not save you.
The second remote aliases to the first, and clicking the second extension loads the FIRST extension's UI/list
("first-loaded wins"). Set it once, per extension:

```js
// frontend/federation.config.js
const { withNativeFederation, share, NG_SKIP_LIST } =
  require('@angular-architects/native-federation/config');

const REMOTE_NAME = 'duploExtensionMyThing';           // ← unique per extension; change ONLY this
module.exports = withNativeFederation({
  name: REMOTE_NAME,                                   // must be globally unique
  exposes: { './Extension': './src/app/extension.routes.ts' },
  shared: { ...share({ /* a SUBSET of duplo-ui/portal/federation.shared.js — see 02-authoring-guide */ }) },
  skip: [...NG_SKIP_LIST, /\/schematics(\/|$)/, '@ngbracket/ngx-layout/server'],
});
```
(The full `shared` block, and why it is a subset rather than a mirror, is in
[02-authoring-guide](02-authoring-guide.md#native-federation-sharing--share-the-libs-di-peer-packages-avoids-nullinjectorerror).)

Keep the manifest's `frontend.remote.remoteName` equal to `REMOTE_NAME`. **`build-extension.sh` does not check
this** — the name/manifest mismatch is caught only by the standalone verifier, which you run yourself after
building:
```bash
node scripts/verify-remote-federation.js extensions/<name>
```
And even that only compares your remote against your own manifest — it cannot see an extension built in another
repo, so global uniqueness stays your responsibility, not the tooling's.

## Checklist
- [ ] Child spec extends `ParentRefSpec<TParent>`; child controller extends `ChildResourceController<>`, OVERRIDES
      `Create` (stamps `parentId`, creates via `Service.CreateAsync`, returns 201 — see top of this doc).
- [ ] Unique `REMOTE_NAME` → federation `name` == manifest `frontend.remote.remoteName` (multi-extension safety).
- [ ] Nested menu = TOP-LEVEL `collapsible-section` with `item` children (not a merged `collapsible`).
- [ ] Manifest has two `resources[]`; the child carries the `parent` block.
- [ ] Parent hook cascades delete to children.
- [ ] FE: nested `menu.node.children[]` (Pattern A) and/or a child table in the parent view (Pattern B); nested
      `routes[]` with `:parentId`.

See also: [03-base-classes](03-base-classes.md), [04-hooks](04-hooks.md),
[07-scope-credentials](07-scope-credentials.md) (if the child provisions against an external system).
