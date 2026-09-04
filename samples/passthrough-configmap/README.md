# passthrough-configmap — synchronous single-object provisioning

Demonstrates **passthrough** mode: one Kubernetes ConfigMap created/updated/deleted **synchronously** on CRUD,
no agent and no worker. With **no skill mapping**, the base sets `ProvisionedMode = Passthrough` and calls the
`*Direct*` seams. The k8s client comes from the SDK's `IScopeClientFactory`.

## Hooks used (and why)
| Hook | Why |
|---|---|
| `ProvisionDirectAsync` | Create the ConfigMap synchronously on resource create (`client.CoreV1.CreateNamespacedConfigMapAsync`). |
| `UpdateDirectAsync` | Re-apply on update (`ReplaceNamespacedConfigMapAsync`). |
| `DeprovisionDirectAsync` | Delete the ConfigMap on deprovision (`DeleteNamespacedConfigMapAsync`). |
| `AutoDeleteOnDeProvision => true` | Hard-delete the row once the object is gone (passthrough default; shown explicitly). |

No skill mapping in `manifest.json` → passthrough. Attach a **kubernetes** scope; create with `namespace` + `data`.

## Deprovision
`DeprovisionAsync` → `DeProvisioning` → `DeprovisionDirectAsync` (sync delete) → `DeProvisioned` →
`AutoDeleteOnDeProvision` removes the row. See `reference/11-deprovisioning.md`.

## Build
```bash
DUPLO_BASE=http://localhost:60021 ./scripts/build-extension.sh  samples/passthrough-configmap
DUPLO_BASE=http://localhost:60021 ./scripts/deploy-extension.sh samples/passthrough-configmap/dist/extension.zip
```
