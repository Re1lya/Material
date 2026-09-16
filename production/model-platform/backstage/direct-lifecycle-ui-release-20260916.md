# Direct lifecycle UI release — 2026-09-16

## Problem

The production `qwen38-27b` instance had already moved from per-operation
GitOps files to Direct Operations, but several visible buttons still linked to
the historical `start-model-inference` and `stop-model-inference` Scaffolder
templates. Those actions require an instance file on Gitea `main`; the file was
intentionally removed during the ownership migration, so every click failed
before changing Kubernetes.

## Released correction

- Dashboard Start uses the latest saved database configuration version and
  POSTs to Direct Operations.
- Dashboard Stop POSTs to Direct Operations.
- Active Direct Operations continue to lock the buttons and feed the dashboard
  phase timeline.
- The model recipe preview and side panel use the same Direct Operations
  Start/Stop functions; the duplicated GitOps lifecycle links were removed.
- The deployment name is fixed to `qwen38-27b` and shown read-only while
  multi-instance support remains deferred.
- The legacy Start/Stop template locations were removed from the Backstage
  catalog. The template files remain in source history as rollback material.
- The overlay Dockerfile now deletes the inherited frontend `dist` before
  copying the new build, preventing obsolete hashed JavaScript assets from
  remaining addressable.

The general `request-model-deployment` template remains catalogued because it
is a separate reviewed GitOps request workflow, not the removed lifecycle
operation path.

## Provenance and validation

- UI PR: `gitadmin/platform-backstage#14`
- stale-asset PR: `gitadmin/platform-backstage#15`
- final main: `f8a164888a46920cc18a0236bff530f973814e60`
- build-context SHA256:
  `24d4859f3f357884d7dae0a7976aab2155e017768a2f6c707b5da1c4a2a8a5b0`
- production image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.20-direct-ui-f8a1648-r2@sha256:196ef9b98ca5eb2da917d4829bdd1e948cf847bc06e704bcf5bfa95ae7bc56a3`
- architecture: `linux/amd64`
- OCI revision: `f8a164888a46920cc18a0236bff530f973814e60`
- Dashboard tests: 5/5 passed.
- Model recipe tests: 4/4 passed.
- Backend/application build passed.
- Candidate image inspection returned both
  `legacy_ui_strings=ABSENT` and `legacy_catalog_locations=ABSENT`.

## Production acceptance

- Backstage Pod is Ready with zero restarts and the runtime image ID matches
  the pinned digest.
- `/healthcheck`, `/kcc-pretraining`, `/model-recipes`,
  `/model-deployments`, `/data-pipeline` and
  `/api/model-platform/deployments` returned HTTP 200.
- Catalog database template entities contain only
  `operate-kcc-training`, `request-kcc-training` and
  `request-model-deployment`; the legacy inference Start/Stop templates are
  absent.
- The running Pod's frontend `dist` contains none of
  `start-model-inference`, `stop-model-inference` or
  `Legacy GitOps fallback`.
- `qwen38-27b` remained Stopped at generation 79 with
  Synced/Ready/Responsive true; no NPU workload was created.

The Running Window was closed during the correction. The final capacity check
reported host processes on all A3 device IDs `0-15`, including the configured
soft pool `8-15`, so the window remains closed. Reopen it only after a fresh
capacity check returns a topology-valid selected pair.
