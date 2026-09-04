# Registration — In-Platform vs Local, and SDK Versioning

A extension bundle (`{manifest.json, backend/, fe/, skills/}` zip) is registered by **loading** it into a
running studio. There are two ways in, and they differ only in the endpoint + token.

## Mode A — In-platform (Extension resource provisioning ticket)

A user creates a **Extension resource** in Extension Studio; the standard provisioning lifecycle runs this
skill in a ticket. The platform (`ResourceProvisioningManager`,
`Duplo.Ai.DataManagement/.../Services/ResourceProvisioningManager.cs`) hands the agent everything:

- **Inputs:** the spec is written to `shared/<subtype>.json` in the ticket workdir
  (`extension.json` for the Extension resource). The skill template is seeded into
  `.claude/skills/duplo-extension-dev/` (templates + reference included).
- **`platform_context`:** `duplo_base_url` and a **resource-scoped JWT** (`duplo_token`), plus any
  selected scope's **cloud credentials** under `platform_context.scopes`.
- **Token scopes (48h):** the scoped JWT authorizes only this resource's
  `…/{id}/status`, `…/{id}/results`, `…/{id}/load`, `…/{id}/load-bundle`.
- **Env the skill reads:** `DUPLO_BASE` (fallback `DUPLO_HOST`) and `DUPLO_TOKEN`.

Load endpoint (resource-scoped, on the Extension resource):
```
POST {DUPLO_BASE}/v1/aiservicedesk/user/data/workspaces/{ws}/environment/extensions/{id}/load-bundle
Authorization: Bearer {DUPLO_TOKEN}        # the scoped token
Content-Type: application/zip
<bundle.zip>
```
Then mark the Extension resource done with `POST …/extensions/{id}/status {"status":"Complete"}`.

## Mode B — Local developer (Claude on your machine)

Run this skill locally. It cannot rely on an injected token, so **you provide**:
- the platform **base URL** (e.g. `https://<tenant>.duplocloud.net` or `http://localhost:60021`), and
- an **admin bearer token** (a user with the `Administrator` role).

Build the bundle the same way, then register via the **admin** endpoint:
```
POST {BASE}/v1/aiservicedesk/admin/extensions/load-bundle      # [Authorize(Roles="Administrator")]
Authorization: Bearer {ADMIN_TOKEN}
Content-Type: application/zip
<bundle.zip>
```
Admin extension management (`Duplo.Ai.Studio.ExtensionStudio/Controllers/Admin/ExtensionsController.cs`):
| Verb · Route | Purpose |
|---|---|
| `POST /v1/aiservicedesk/admin/extensions/load-bundle` | Load/upgrade from a zip body (unpacks + hot-loads). |
| `POST /v1/aiservicedesk/admin/extensions/load` | Load from a `manifest` (DLL already staged on the extensions volume). |
| `GET  /v1/aiservicedesk/admin/extensions` · `GET {id}` | List / inspect loaded extensions. |
| `POST /v1/aiservicedesk/admin/extensions/{id}/disable` | Unregister (unload, withdraw routes). |
| `DELETE /v1/aiservicedesk/admin/extensions/{id}` | Disable + purge the record. |
| `GET /v1/aiservicedesk/extensions/sdk-version` | Host SDK version (authenticated — send the bearer token). |
| `GET /v1/aiservicedesk/extensions/sdk-bundle` | SDK NuGet feed as a zip (authenticated — send the bearer token). |

The skill **auto-detects** the mode: if `$DUPLO_TOKEN` + `$DUPLO_BASE`/`$DUPLO_HOST` are present →
Mode A (in-ticket); otherwise → Mode B (ask for base URL + admin token).

## Getting the SDK to compile against (both modes)

The host serves its own SDK as a NuGet feed:
1. `GET …/extensions/sdk-version` → e.g. `{"version":"1.0.2"}` — pin this.
2. `GET …/extensions/sdk-bundle` → zip of `.nupkg`s; unzip into `backend/sdk-packages/`.
3. `backend/nuget.config` points at `./sdk-packages`; the `.csproj` references
   `Duplocloud.AiHelpdesk.Sdk` `Version="[$(DuploSdkVersion)]" ExcludeAssets="runtime"` (compile-only).
4. `dotnet publish backend -p:DuploSdkVersion=<version>` → ships only your DLL (SDK assemblies are NOT
   bundled; the host's Default ALC provides them at load → shared type identity).

## SDK version pinning — why exactness matters

`ExtensionStudioLoader` **rejects** a bundle whose `manifest.sdkVersion` ≠ the host's running SDK version. The host
version is read from the running `Duplo.Ai.Model` assembly; the whole repo's assemblies are versioned from
the root `VERSION` file via `Directory.Build.targets`, and `pack-sdk.sh` packs the feed at that same
version. So host runtime == feed == your extension's pin. (A skew here is exactly the bug that caused
`Could not load file or assembly 'Duplo.Ai.DataManagement, Version=…'` before the `Directory.Build.targets`
fix.) Always set `manifest.sdkVersion` from `sdk-version`, and build against the matching `sdk-bundle`.

## What a local run needs (checklist)
- Base URL + an Administrator bearer token.
- .NET 8 SDK + Node 22 (Angular 22 requires `^22.22.3 || ^24.15.0 || >=26.0.0`) + npm `>= 10.9.0` locally
  (or use the in-platform agent image, which has all of them).
- This skill dir (with `templates/helloworld/` + `reference/`).
- Network access to the platform for `sdk-version`/`sdk-bundle` and `load-bundle`.
