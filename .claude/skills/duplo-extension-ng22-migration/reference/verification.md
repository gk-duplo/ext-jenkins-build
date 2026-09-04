# Verifying a migrated extension remote

Two layers. The automated gate proves the artefact is a well-formed Native Federation remote whose
metadata agrees with the manifest and the host. The manual checks cover the two failures that only
appear in a browser.

---

## The gate

Run it **after** `npm install && npm run build` in the extension's `frontend/`. It reads build output;
it does not build anything itself.

```bash
node <devkit>/scripts/verify-remote-federation.js <extension-dir> \
  <portal>/ai-studio/ai-suite-dist/remoteEntry.json
```

- `<extension-dir>` is the directory holding `manifest.json` and `frontend/` — **not** `frontend/`
  itself, and not `frontend/dist/`.
- The second argument is the **host's** built entry, which enables check 6. Without it the gate still
  runs checks 1–5, so it is useful before you have a portal build to hand — but shared-scope skew is
  exactly the class of bug that reaches production, so pass it whenever you can.

Success is a single line and exit 0:

```
OK: <extension-dir> is a loadable Native Federation remote
```

Failure prints one `FAIL: <reason>` line per problem on **stderr** and exits 1. The gate deliberately
reports **every** problem it can see in one run — each check is gated only on its own inputs being
readable, never on whether an earlier check passed — so fix all the lines before rebuilding. Malformed
or unreadable JSON is reported as a `FAIL` line too, never as a stack trace. Exit code 2 means bad
usage (no `<extension-dir>` argument).

---

## The six checks

### 1. `frontend/dist/remoteEntry.json` exists

```
FAIL: no <dir>/frontend/dist/remoteEntry.json — the frontend did not produce a Native Federation entry (build it first)
```

Means: this is not a Native Federation build. Either the build never ran, or it ran and produced a
Webpack `remoteEntry.js`. Check in that order:

- Did `npm run build` actually succeed? Re-run it and read the exit code.
- Is `frontend/dist/remoteEntry.js` (no `.json`) present? Then `angular.json` still uses
  `ngx-build-plus:browser` — SKILL.md step 3 was skipped or reverted.
- Is `federation.config.js` present, and is the `build` target
  `@angular-architects/native-federation:build` pointing at an `esbuild` target that exists under the
  same project key? A typo in either `target` string builds a plain app with no federation output.

### 2. `frontend/dist/browser/` does NOT exist

```
FAIL: <dir>/frontend/dist/browser/ exists — set angular.json outputPath to { "base": "dist", "browser": "" }
```

Means: Angular 17+'s default `dist/browser/` layout survived. `scripts/build-extension.sh` copies
`frontend/dist/.` straight into the bundle's `fe/`, so the packaged extension would serve
`fe/browser/remoteEntry.json` while the manifest points at `fe/remoteEntry.json` — a 404 at load time
with no other symptom.

Fix in `angular.json`, under the `esbuild` target's `options`:

```json
"outputPath": { "base": "dist", "browser": "" }
```

Then `rm -rf frontend/dist` before rebuilding — the stale `browser/` directory is not cleaned by the
new configuration and will keep failing this check.

### 3. `remoteEntry.json` `.name` === manifest `.frontend.remote.remoteName`

```
FAIL: remoteEntry.json name 'X' !== manifest remoteName 'Y'
```

Means the container the host asks for and the container the remote publishes are different names. The
host resolves the extension by the manifest value, finds no such container, and the route fails.

`X` comes from `const REMOTE_NAME` in `federation.config.js`; `Y` from the manifest. Change whichever
is wrong — but if you are renaming to resolve a collision with another installed extension, change
**both**, and remember the manifest is the authority.

### 4. Manifest `remoteEntry` URL ends in `/remoteEntry.json`

```
FAIL: manifest frontend.remote.remoteEntry is '…/fe/remoteEntry.js' — must end in /remoteEntry.json
```

Means SKILL.md step 7 was skipped. The manifest still points at the Webpack container filename. Note
this check is on the **URL string in the manifest**, independent of check 1 — an extension can build a
perfectly good `remoteEntry.json` and still ship a manifest pointing at the old path, in which case
both this line and nothing else appears.

### 5. The manifest's `exposedModule` is present in `remoteEntry.json` `.exposes`

```
FAIL: manifest exposedModule './Extension' not in remoteEntry exposes [./Foo]
```

Means the `exposes` keys in `federation.config.js` and the manifest disagree. Both must say
`'./Extension'`:

```js
exposes: { './Extension': './src/app/extension.module.ts' },
```

If the key matches and this still fails, the exposed path in `federation.config.js` does not resolve to
a real file — NF drops an unresolvable expose rather than failing the build.

Related but **not** covered by the gate: the exported class inside that file must be named `Extension`,
because the host's `extension-route-registrar.ts` resolves `m.Extension`. A renamed class passes every
check here and then fails at runtime with an undefined module.

### 6. Every shared package the remote declares is published by the host at the same major

Only runs when the host entry argument is given.

```
FAIL: shared 'X' is declared by the remote but not published by the host
```

The remote's shared list is not a subset of the host's. Either the package genuinely is not shared by
the portal — remove it from `federation.config.js` and let the remote bundle it — or the portal is an
older build that predates the entry. Check the host's `federation.shared.js` before assuming the
extension is wrong.

```
FAIL: shared 'X' major mismatch: remote 1.2.3 vs host 2.0.0
```

Major only. The shared configs all use `strictVersion: false`, which tolerates the minor/patch skew
that independently deployed host and remote inevitably accumulate — but not a major, which means
genuinely incompatible APIs behind one shared instance. Align the version in the extension's
`package.json` with the host's and reinstall.

Two things this check deliberately ignores:

- `@nf-internal/chunk-*` pseudo-entries, which NF injects per build with hash-derived names that can
  never match across two independent builds.
- `requiredVersion` strings. It compares **resolved** versions, which is why SKILL.md's caret-everything
  rule costs nothing.

And one failure mode worth recognising:

```
FAIL: <path> has no 'shared' array — is it a Native Federation host remoteEntry.json?
```

You passed the wrong file — a Webpack-era entry, or some other JSON. This is reported as one line
instead of letting every remote package report as unpublished and bury the real cause.

---

## Manual checks the gate cannot make

The gate reads static metadata. These two need a running portal with the extension hot-loaded
(`scripts/build-extension.sh` then `scripts/deploy-extension.sh`).

### Navigate from the left-hand menu — not a cold deep-link

Extension routes are injected **at runtime**: `extension-route-registrar.ts` fetches the FE manifest and
adds each extension's lazy child route under `suite/:tenantId` after the app has started. A hard refresh
straight onto an extension URL races that async injection and can land on the `**` fallback. This is a
known limitation of the host, not a defect in the extension.

So always test the normal path: load the portal, wait for it to settle, then click the extension's menu
item. If **that** works and only the deep-link fails, the extension is fine.

If the menu item is missing entirely, the problem is in the manifest's `frontend.menus`, not in
federation.

### No `NG0201` / `NullInjectorError` in the console

Open the browser console before navigating, and keep it open while the page renders and while you
exercise the list, add and view screens. A missing shared DI-carrying peer only throws when a component
that injects the affected service is actually constructed, so a list page can render clean and the add
form still blow up.

`NG0201: No provider for <X>` on a page that works inside the portal itself means two copies of the
package owning `<X>`. Add it to `shared` in `federation.config.js` and rebuild — see the "DI-carrying
peer left unshared" trap in SKILL.md. `FlexLayoutServerLoaded`, `TranslateService`,
`NGX_ECHARTS_CONFIG` and `FlatpickrDefaults` are the ones seen in practice.

### Sanity-check the network tab

On first navigation to the extension you should see a request for the extension's
`…/fe/remoteEntry.json` followed by its chunk files.

**No request at all**, with no console error and no timeout, is the host-side
`REMOTE_LoadRemoteModule` bug — see the "Host requirement" section in SKILL.md. It is not fixable from
the extension.

---

## Quick reference

```bash
# in the extension's frontend/
npm install && npm run build

# from anywhere
node <devkit>/scripts/verify-remote-federation.js <extension-dir> \
  <portal>/ai-studio/ai-suite-dist/remoteEntry.json

# what the artefact says about itself
node -e "const e=require('<extension-dir>/frontend/dist/remoteEntry.json');
  console.log(e.name, JSON.stringify(e.exposes),
              (e.shared||[]).filter(s=>!s.packageName.startsWith('@nf-internal/')).length + ' shared')"
```
