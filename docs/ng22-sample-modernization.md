# Angular 22 sample modernization — progress

Tracks the pass that brought every `samples/*` frontend up to the modern Angular 22 shape, using
`samples/helloworld/frontend/` as the reference.

> **Historical record.** The samples set has since been consolidated: `form-wizard`, `form-complex`,
> `enrichment-pods`, and `on-demand-plan` were removed (their patterns — wizard, complex forms, enrichment,
> on-demand actions — now live in the bigger `samples/network-stack`). References to them below describe the
> repo as it was during this pass.

**This is not the webpack → Native Federation migration.** All nine samples were already moved to
Angular 22 + Native Federation (`federation.config.js`, `@angular/core ^22.1.0`, no `webpack.config.js`).
The remaining work is code shape, and it is not cosmetic — see *Why this matters* below.

## Why this matters

Angular 22 defaults a component with **no `changeDetection` property to `OnPush`**. The earlier bulk
migration added `ChangeDetectionStrategy.Eager` to the `list/` components only. Every `add/` and `view/`
component was left without it while still assigning plain fields from a `subscribe` — so those pages
render their shell and never populate. The build passes, the console is silent, and the page just says
"Loading…" forever.

**18 components across 8 samples are affected.** This pass fixes them by construction: state moves to
signals, so a write marks the view dirty on its own and no strategy line is needed.

## Target shape (match `helloworld`)

| Concern | Target |
|---|---|
| Entry point | `extension.routes.ts` exporting `Extension: Routes`; `federation.config.js` exposes it. No `extension.module.ts`. |
| Components | standalone (no `standalone` flag), own `imports`, **no `changeDetection`** |
| State | `signal()` / `computed()`; no plain fields written from async callbacks |
| DI | `inject()`; string tokens need `inject<any>(TOKEN as any)` |
| Queries | `viewChild()` (returns a signal — call it) |
| Inputs | `input()` + `computed()` instead of `@Input()` + getters |
| Control flow | `@if` / `@for` (with `track`) / `@switch` |
| Teardown | `takeUntilDestroyed(destroyRef)` |
| Forms | template-driven, but `[ngModel]` + `(ngModelChange)` — `[(ngModel)]` cannot write to a signal |
| `result-template/` | **left alone** — vendored host code, stays on the old shape until the lib exports it |

## Known cross-sample defects

Fix these in each sample as it is migrated.

| Defect | Affects | Fix |
|---|---|---|
| `pattern="…[a-zA-Z0-9-]…"` in the Add form's Name field is **not a valid regex under the RegExp `v` flag**, which browsers now use to compile `pattern`. The validator throws and **fails open** — any name is accepted. | every sample with a Name field — including `form-wizard` (its `[a-z0-9-]` was originally miscounted as safe) and `helloworld`, the reference the others were copied from, which is how it spread | Escape the hyphen: `[a-zA-Z0-9\-]`. In a TS template literal write `\\-`. Verified to reject `-bad` / `bad-` and accept `calc-1`. **All samples are now clean** — `grep -rn 'pattern="[^"]*[a-zA-Z0-9]-\]' samples --include=*.ts` returns nothing. |
| `package.json` `name` is `duplo-extension-helloworld-remote` (copy-paste leftover). `REMOTE_NAME` in `federation.config.js` is correct and unique, so federation is unaffected. | `enrichment-pods`, `on-demand-plan`, `passthrough-configmap`, `worker-appstack`, `worker-compute` | Rename to `duplo-extension-<sample>-remote` and fix the description. |

### Not fixed in this pass — frontend/backend model mismatch

Three samples ship a frontend that was copied from `helloworld` and never adapted to their own backend.
The UI collects and displays `firstName` / `lastName` / `fullName` for resources whose real spec is
something else entirely, and their `ORIGIN_TYPE` / `SUB_TYPE` still say `HelloWorld` / `hello-world`, so
the origin-context lookup behind **Track Provisioning** queries the wrong resource type and silently
finds nothing.

| Sample | Backend spec / result | Frontend spec / result |
|---|---|---|
| `passthrough-configmap` | `Namespace`, `Data` (dictionary), `Uid` | `firstName`, `lastName` → `fullName` |
| `on-demand-plan` | `Description` | `firstName`, `lastName` → `fullName` |
| `worker-appstack` | `DeploymentName`, `Image`, `Namespace`, `Replicas` | `firstName`, `lastName` → `fullName` |

Verified against each `manifest.json` (`ticketOriginType`) and the backend `.cs` types, and confirmed
**identical on `origin/main`** — this predates the Angular 22 work and is not a migration regression.
**Deliberately left alone** — this pass is modernization only, and fixing it means redesigning each Add form, list and
view around the real spec. Worth its own ticket.

`enrichment-pods`, `form-complex`, `form-wizard` and `parent-child` are correctly modelled.

### Not fixed in this pass — MinIO "Live Pods" table renders "No data"

`enrichment-pods`' `MINIO_VIEW_TEMPLATE` declares its pods table as:

```ts
{ type: 'table', key: 'pods', value: 'result.pods', columns: [...] }
```

but the `table` field type requires **`source`**, not `value` (see `TemplateTableField` in
`result-template/result-view-template.model.ts`). `resolveSource()` reads `field.source`, gets
`undefined`, and returns `[]` — so the tab renders "No data" even though the data is present (the
sidecard reading `result.pods.length` correctly shows 2).

One-word fix (`value:` → `source:`), byte-identical to `origin/main`, and it defeats the sample's
headline feature — enriching the Result view with live pod data. Left alone per the modernize-only
scope; worth its own ticket.

> Comments inside a component's `template:` backtick string must not contain backticks — they terminate
> the template literal and produce confusing parse errors far from the real line. (Hit twice; the errors
> point at unrelated lines and read as `TS18004: No value exists in scope for the shorthand property`.)

> An **interpolated** `name="x{{ i }}"` on an input with `ngModel` binds to NgModel's `@Input() name`
> rather than the DOM attribute, so `getAttribute('name')` returns null while the control is registered
> correctly. Do not treat the missing attribute as a bug — verify binding functionally instead
> (`ng.getComponent(el)` and read the model).

> Under the default OnPush strategy, an `@if` reading a **plain object** (e.g. a template-driven form's
> `model.enableLb`) still repaints, because the `(click)` / `(ngModelChange)` that changed it is a
> template event and marks the view dirty. Only state written from outside a template event — a
> `subscribe` callback — needs to be a signal. Verified in `form-complex`.

## How each sample is verified

1. Build the extension (`npm run build` in `frontend/`).
2. Serve `dist/` on **4401**: `npx http-server dist -p 4401 --cors -c-1`
3. Point the portal's `mockLocalExt` (in `duplo-ui/portal/src/app/services/extension-manifest.store.ts`)
   at `http://localhost:4401/remoteEntry.json` using the sample's own `manifest.json` frontend blob.
   **This stays uncommitted in the portal repo.**
4. `npm run run:all` in the portal, log in, exercise list → view → add → create.
5. A temporary datasource-level mock (`<name>.mock.ts` + `if (USE_MOCK)` branches) supplies data so no
   backend is needed. **Removed entirely before committing** — no mock reference ships.
6. **Parity check against `main`.** This pass must not change behaviour, so before committing, confirm
   the functional contract still matches the pre-migration code on `origin/main`:

   ```bash
   S=<sample>
   # the service carries the API integration — it must be byte-identical
   diff <(git show origin/main:samples/$S/frontend/src/app/<svc>.service.ts) \
        <(git show HEAD:samples/$S/frontend/src/app/<svc>.service.ts)

   # components: same service calls and same navigation targets
   for f in list/*.component.ts add/*.component.ts view/*.component.ts; do
     diff <(git show origin/main:samples/$S/frontend/src/app/$f | grep -oE 'svc\.[a-zA-Z]+\(|navigate\(\[[^]]*\]' | sort -u) \
          <(git show HEAD:samples/$S/frontend/src/app/$f       | grep -oE 'svc\.[a-zA-Z]+\(|navigate\(\[[^]]*\]' | sort -u)
   done
   ```

   Any difference is either an intentional, documented fix or a regression — there is no third case.
   Also confirm any defect you find is **pre-existing on `main`** before deciding whether it is in scope;
   the model mismatch below was verified that way.

## Progress

| # | Sample | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | `worker-compute` | ✅ done | `07acb79` | list/add/view/status-badge + routes. Verified in browser: menu, list (3 rows), view renders, create round-trip. Fixed the `v`-flag pattern bug and the package name. |
| 2 | `passthrough-configmap` | ✅ done | `c61f6f9` | Same shape + a `track` list action. Verified: list, view, create round-trip. **Frontend model does not match its backend** — see below; left as-is per instruction. |
| 3 | `worker-appstack` | ✅ done | `e956062` | Components were byte-identical to passthrough-configmap on `main`, so the same modernized files transfer verbatim. Verified: list, view, create round-trip; parity vs `main` clean. Shares the frontend/backend model mismatch — left as-is. |
| 4 | `enrichment-pods` | ✅ done | `78a4905` | Real MinIO model (namespace/image/replicas/pods), 7-field Add form. Verified: list, view Endpoints group, create round-trip; parity vs `main` clean. **`node_modules` was missing** — needed `npm install` first. Live Pods table shows "No data" — see below. |
| 5 | `on-demand-plan` | ✅ done | `ade7b87` | Byte-identical clone of passthrough-configmap on `main`, so the modernized files transfer verbatim. Verified: list (3 rows), view, create round-trip; parity vs `main` clean. Shares the frontend/backend model mismatch — left as-is. |
| 6 | `form-complex` | ✅ done | `bebc8d7`, `0fa1707`, `e7599e4` | 2 steps + conditional HPA/LB blocks, repeatable env rows, ng-select. Add form restyled to the platform V2 `panel-form-accordion` shape mirroring `ai-studio/.../add-workspace` — one shared side-nav `ng-template` rendered per panel, so every step lists all steps; the hand-rolled wizard-stepper is gone. Container Config is always expanded (product call). Verified: both steps, side-nav jump keeps entered values, all conditionals reacting, env-var binding, create round-trip, view. Parity vs `main` clean — identical field set, options and model. |
| 7 | `form-wizard` | ✅ done | `96c19c1` | 4-step wizard, per-step `ngModelGroup` validation, bespoke stepper (kept — it is the sample's point, and `form-complex` now demonstrates the V2 accordion instead). Stepper converted to `input()`/`output()`/`computed()`; **add and view were both OnPush-broken**. Fixed the `v`-flag pattern the table above had wrongly cleared. Verified: list, search, view, all four steps with gating, Back keeping values, create round-trip. Parity vs `main` clean. |
| 8 | `parent-child` | ✅ done | `11c3e93` | Nested parent/child routing (Pattern B); **4 of 5 feature components were OnPush-broken** — every add and view. The parent view carries its own children table, so it gets a second `computed()` filter. Fixed the `v`-flag pattern on both Name fields and the Add Child dead-end below. Verified: parent list, parent detail (Children + Result tabs, child search), child detail (Result auto-select, Spec toggle, Back to Parent), both create round-trips. Parity vs `main` clean apart from that one navigation fix. |

`helloworld` was migrated earlier and is the reference. **All eight samples are done.**

### Fixed — Add Child dead-ended on `/app/errors/not-found`

`parent-child`'s add-child called `navigate(['..'])` from the route `view/:parentId/children/add`. That
path is FOUR segments in a single `Route`, so one `..` pops to `view/:parentId/children`, which matches no
route — both Provision and Cancel landed on not-found. `view-child.back()` at the same depth already used
`['../..']`. Confirmed identical on `main` (pre-existing, not a migration regression) and fixed here, since
it makes the sample's headline flow unusable.

Relative navigation counts URL SEGMENTS, not route-config nesting depth. A flat multi-segment `path:`
needs one `..` per segment.

## Per-sample checklist

- [ ] `extension.module.ts` → `extension.routes.ts`; `federation.config.js` `exposes` repointed
- [ ] every component standalone, no `changeDetection`, state in signals
- [ ] `inject()` / `viewChild()` / `input()` + `computed()`
- [ ] `@if` / `@for` / `@switch`; `takeUntilDestroyed`
- [ ] `[ngModel]` + `(ngModelChange)` on every form field
- [ ] `v`-flag `pattern` fix (if the sample has one)
- [ ] `package.json` name/description (if a helloworld leftover)
- [ ] builds clean
- [ ] verified in the portal against mock data
- [ ] mock removed, rebuilt, no `USE_MOCK` reference anywhere in `src/`
