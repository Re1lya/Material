# Model platform agent handoff

This file is the mandatory starting point for any Agent continuing work in
this repository. It describes actual production state as of 2026-08-11 and the
rules for safely continuing the deployment.

## Mandatory operating rules

1. Do not connect to any host with SSH, SCP, SFTP or another remote-execution
   mechanism. The user must run proposed commands and return sanitized output.
2. Never request, store, echo, commit or reproduce SSH passwords, Kubernetes
   tokens, Gitea credentials, Artifact Keeper tokens, private keys or other
   secrets. Ask the user to enter secrets interactively when required.
3. Separate read-only diagnosis from production writes. Present the exact
   target, effect, rollback concern and validation before asking the user to run
   a write command.
4. Never modify unrelated namespaces or workloads. Do not create an NPU
   workload, RayService, model-cache Job, PVC, XR or `ModelDeployment` until the
   corresponding phase is explicitly approved.
5. Do not use bare `kubectl` or bare `helm` on `server-00`. The admin user's
   default context is the old Kind POC, not production. Production commands must
   use `sudo k3s kubectl` and Helm must include
   `--kubeconfig /etc/rancher/k3s/k3s.yaml`.
6. Keep production synchronization manual. Argo CD prune and self-heal remain
   disabled unless a later reviewed decision explicitly changes this.
7. Keep runtime images in `110.120.0.3:8889` and pin immutable digests. Check
   architecture before release. The production control node is AMD64; the
   approved model runtime target is ARM64 Ascend and must use its own image.
8. Use Git as the source of truth for non-secret manifests. Do not commit
   rendered secrets, generated credentials, kubeconfigs or live object dumps.

## Read these files in order

1. `model-platform-production-integration-plan.md` — target architecture,
   platform objects, upload/cache/deployment flow and staged rollout plan.
2. `production/model-platform/progress-20260810.md` — consolidated actual
   production state and remaining risks.
3. `production/model-platform/README.md` — repository layout and safety gates.
4. `production/model-platform/gitea/deployment-record-20260810.md` — Git service
   deployment and persistence.
5. `production/model-platform/argocd/deployment-record-20260810.md` and
   `production/model-platform/gitops/deployment-record-20260810.md` — Argo CD
   and the current manual, non-pruning GitOps loop.
6. `production/model-platform/tekton/deployment-record-20260811.md` — current
   Gitea-to-Tekton CI loop and its tokenless security model.
7. `production/model-platform/crossplane/deployment-record-20260811.md` —
   Crossplane Core, XRD state, RBAC boundary and the kubeconfig trap.
8. `production/model-platform/catalog/` and
   `production/model-platform/cache/` — prepared model metadata, runtime profile
   and cache implementation; these files are not proof that runtime deployment
   has occurred.

Before editing, also inspect `git status`, the current branch and recent log.
Preserve unrelated user changes.

## Actual production state

The production target is the K3s cluster on `server-00`, Kubernetes
`v1.34.6+k3s1`. The old `kind-platform-poc-2` environment is only a POC and its
resources must never be reported as production state.

| Module | Production state |
|---|---|
| Artifact Keeper | Running in `artifact-keeper`; 480Gi artifact PV + 20Gi PostgreSQL PV; Qwen model 24/24 files checksum-verified |
| Gitea | Running in `gitea`; private config repository and persistent PostgreSQL are verified |
| Argo CD | Running in `argocd`; one minimal manually synchronized Application; no prune/self-heal |
| Tekton | Operator, Pipelines and Triggers Running; Gitea main-push webhook successfully runs tokenless validation |
| Crossplane | Core 2.3.4 and RBAC Manager Running; 21 core CRDs; no Provider/Function/Configuration |
| ModelDeployment API | v2 namespaced XRD Established; no Composition and no instances, therefore not Offered |
| ModelVersion / RuntimeProfile | YAML catalog materials exist but are not yet backed by completed production APIs/controllers |
| Model cache | Fetcher and Job material exist; no production cache Job has run |
| Qwen runtime | No new production inference deployment has been created by this project |
| Backstage | Not deployed or connected in production |

Crossplane declares only 200m CPU and 512Mi memory requests in total and uses
no PVC. At its first steady observation it used about 5m CPU and 176Mi memory.

## Current connections

```text
Gitea main push -> Tekton EventListener -> validation PipelineRun
Gitea repository -> Argo CD repo-server -> manually synchronized bootstrap App
Artifact Keeper <- verified Qwen model artifacts
Crossplane Core -> established ModelDeployment API only
```

There is not yet a Tekton-to-Argo promotion path, Artifact Keeper publish task,
Crossplane Composition, Crossplane-to-KubeRay runtime path, cache controller or
Backstage self-service path.

## Recommended next deployment sequence

1. Define production schemas for `ModelVersion` and `ModelRuntimeProfile`, and
   extend Tekton validation for schema, immutable digest and cross-reference
   checks. Keep the CI ServiceAccount tokenless.
2. Pin, architecture-check and mirror the required Crossplane Composition
   Function image into the internal registry.
3. Build the Crossplane v2 Pipeline-mode Composition for `ModelDeployment`.
   First validate rendering with no real XR. Do not grant KubeRay management or
   create a RayService yet.
4. Put reviewed XRD/Composition/catalog files into the production Gitea GitOps
   repository and add a narrowly scoped, manual Argo CD Application. Continue
   with no prune and no self-heal.
5. Implement the model-cache control contract and read-only Artifact Keeper
   runtime credential. Run a cache-only test only after the user approves node,
   disk and network impact; it must request zero NPU.
6. When NPU capacity is explicitly confirmed idle, run one controlled Qwen
   end-to-end test: approval, cache verification, runtime creation, health,
   minimum inference, rollback and cleanup.
7. Add Backstage only after the API and approval path are stable.

This is an update path, not a rebuild. Helm revisions, CRD versions,
Compositions and GitOps applications should be evolved in place with explicit
compatibility and data checks.

## How to request production information

Give the user small read-only command groups, explain what each group proves,
and ask them to paste back the output. Typical safe examples are:

```bash
sudo k3s kubectl get pods -A -o wide
sudo k3s kubectl get events -A --sort-by=.lastTimestamp
sudo k3s kubectl describe node server-00
sudo k3s kubectl get xrd,composition
sudo k3s kubectl get providers.pkg.crossplane.io,functions.pkg.crossplane.io -A
sudo helm list -A --kubeconfig /etc/rancher/k3s/k3s.yaml
```

For logs, request a bounded time window and component namespace. Do not ask for
Secret YAML, token values, environment dumps or unredacted kubeconfigs.

## Completion standard

Only say a module is deployed when the user has returned evidence for the
correct production kubeconfig showing:

- the intended release/object exists;
- controllers and workloads are Ready with acceptable restarts;
- images and architecture match the version lock;
- declared resource and persistence boundaries match the plan;
- logs and events show no unresolved release error;
- existing platform modules remain healthy;
- the deployment record has been updated and committed.

Prepared YAML, a successful local render, an old Kind POC result or a dry-run
alone is never sufficient evidence of production completion.
