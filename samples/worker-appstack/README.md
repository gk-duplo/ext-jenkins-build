# worker-appstack — background-worker, multi-object provisioning

Demonstrates **worker** mode: a resource that maps to **multiple** Kubernetes objects (Deployment + Service),
reconciled by a **background worker** with retries — not the agent, not synchronous passthrough. The service
returns `Worker` from `NoSkillsFallbackMode`; `AppStackWorker` (a `ResourceWorkerBase`) does the cluster work on
its tick. The worker is registered via an `IDuploExtension` (`AppStackExtension`).

## Hooks used (and why)
| Member | Why |
|---|---|
| `AppStackService.NoSkillsFallbackMode => Worker` | Route create/update/delete through the background worker. |
| `AppStackWorker.ApplyAsync` | Create Deployment then Service (dependency order) via `IScopeClientFactory`. |
| `AppStackWorker.VerifyDriftAsync` | Drift check (no-op in this demo). |
| `AppStackWorker.DeleteSubResourcesAsync` | Delete Service then Deployment (reverse order). |
| `AppStackWorker.WaitForDeletionAsync` | Return true once the Deployment is gone (worker re-ticks until then). |
| `AppStackExtension : IDuploExtension` | `Configure` registers `AddHostedService<AppStackWorker>()`. |

> **Note:** the worker only ticks if the platform's hot-load loader invokes `IDuploExtension.Configure` for
> uploaded extensions. The base worker (`ResourceWorkerBase`) drives the tick loop, status transitions, and retries.

## Deprovision
`DeprovisionAsync` → `DeprovisionInitiated`; the worker tick runs `DeleteSubResourcesAsync` + `WaitForDeletionAsync`
→ `DeProvisioned`. Row retained (audit) by default. See `reference/11-deprovisioning.md`.

## Build
```bash
DUPLO_BASE=http://localhost:60021 ./scripts/build-extension.sh  samples/worker-appstack
DUPLO_BASE=http://localhost:60021 ./scripts/deploy-extension.sh samples/worker-appstack/dist/extension.zip
```
