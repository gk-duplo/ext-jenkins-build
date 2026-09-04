# Parent / Child extension sample

A worked **two-resource** extension: a `HelloParent` that owns many `HelloChild` resources — the generic
shape behind real parent/child pairs (a Job with its Builds, an Environment with its States). It mirrors
`extensions/helloworld` but demonstrates the multi-resource wiring in `reference/08-parent-child-and-menus.md`,
and uses the platform UI library `@duplocloud-internal/ng-common-lib` for every view.

## What it shows
- **Backend:** two typed resources in one DLL. The child's spec extends `ParentRefSpec<HelloParent>` and its
  controller (`ChildResourceController<…>`) is mounted at the nested route
  `…/hello-parents/{parentId}/hello-children`, stamping `Spec.ParentId` from the URL.
- **Manifest:** two `resources[]` entries; the child declares the `parent` link. One menu entry for the parent.
- **Frontend (Pattern B):** a single remote mount (`extensions/hello-parents`) with internal routes for the parent
  list/add/view and the nested child add/view. The parent's **view** lists its children in a
  `<searchable-datatable>` tab with row-links into the child route. Results render via the declarative
  `<app-resource-template-view>` (templates in `resources-frontend-templates/`), with a card fallback.

## Build / load
Same flow as `helloworld` (see `.claude/skills/duplo-extension-dev/SKILL.md`):
```bash
# @duplocloud-internal/ng-common-lib installs from the repo-root packages/*.tgz — no registry auth needed
# fetch SDK → dotnet publish backend → npm install && npm run build (frontend; a plain install — the
#   ngx-toastr peer conflict is handled by the "overrides" block, not by `--legacy-peer-deps`)
# → zip {manifest.json, backend/, fe/, skills/, resources-frontend-templates/} → load-bundle
```
> Controller route changes (the child's nested route) need a studio restart or a version bump to evict the old
> MVC routes — see `reference/08-parent-child-and-menus.md`.
