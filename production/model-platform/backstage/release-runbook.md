# Crossplane and Backstage minimum release runbook

## Status and scope

This runbook is partially executed in production. The Backstage portal stage,
Crossplane safe Composition and production Gitea PR status path have been
deployed and functionally exercised; manual Argo materialization remains
gated.
It also tracks the rolled-out mock scheduling form. It covers four safe
control-plane release units:

1. one Crossplane Composition Function plus a ConfigMap-only Composition;
2. one Backstage replica and one PostgreSQL replica in a new `backstage`
   namespace with a dedicated 20Gi Retain local PV;
3. one constrained Backstage-to-Gitea PR path, Tekton policy/status path and
   manual Argo CD Application that may create only a stopped ModelDeployment.
4. one local mock form that records requested TP/PP/replicas/priority while the
   effective runtime remains fixed and stopped.

The three user-facing phases map to the release steps as follows:

| Phase | Release stages | Finished outcome |
|---|---|---|
| Phase 1: Crossplane safe control plane | 0, 1 and 2 | Function Healthy, XRD Offered, one ConfigMap-only Composition, zero XR |
| Phase 2: Backstage request portal | 3, 4 and 5 | Backstage Ready; its fixed action opens a Gitea PR; Tekton validates the exact PR commit and reports status |
| Phase 3: manual GitOps materialization | 6 | a human-approved merge becomes Argo OutOfSync; one manual non-pruning Sync creates only a stopped XR and status ConfigMap |

The active Crossplane proof instance creates a Deployment with `replicas: 0`,
a Service and a status ConfigMap, but no Pod, Job, PVC, Ray/KubeRay, Volcano or
Ascend/NPU allocation. The Backstage ServiceAccount has
namespace-scoped read access and cannot read Secrets or write resources.

Expected new steady requests are 850m CPU and 1664Mi memory. The Tekton change
adds one short validation Step and one final status Step per Gitea run, not a
steady Pod. This runbook intentionally updates Tekton and adds a second Argo CD
Project/Application, but does not modify Artifact Keeper, Gitea workloads,
Ray/KubeRay, existing model workloads or NPU allocation.

## Observed production acceptance — 2026-08-14

Backstage evidence returned from `server-00`:

- Namespace `backstage` exists; Deployment and PostgreSQL StatefulSet are
  `1/1 Ready`, with zero restarts after the K3s restart;
- `http://110.120.0.3:30070/healthcheck` returns HTTP 200;
- Backstage v0.2.9 runs the Artifact Keeper AMD64 image at digest
  `sha256:fee9830d4ba7f99234033bbfde10c1a5e51edda908c734de70f30015ca92a934`;
  the Pod uses repository-scoped read-only Secret
  `artifact-keeper-backstage-pull`;
- OIDC maps the production Gitea account to `User:default/gitadmin`; the
  catalog and Kubernetes read-only views work;
- RBAC can read approved Pods, cannot read Secrets and cannot create
  Deployments;
- the constrained Scaffolder action succeeded as `user:default/gitadmin` and
  created Gitea PR `#1`, `ModelDeployment: backstage-acceptance-20260814`,
  without creating an XR or model-serving workload;
- `GITEA_REQUEST_TOKEN` accessed the target repository successfully and remains
  in `backstage-secrets`;
- the user confirmed temporary Gitea token `backstage-bootstrap-20260813` was
  revoked; it is not a Kubernetes Secret.

Remaining gates:

- production Tekton now has the Gitea Pull Request Trigger and
  `gitea-ci-status-writer`; PR #1 synthetic event passed all three validators
  and received `tekton/model-platform-policy=success`; real Gitea close/reopen
  delivery has also been confirmed. Nine terminal PipelineRuns remain (six
  succeeded and three historical failures in the old status-report Step), and
  were not cleaned up during the documentation recheck;
- the optional events backend is now installed and its startup is clean;
- the new mock-form image is now the first Backstage image pulled from the
  Artifact Keeper `container-images` repository; the old 8889 image remains
  available for rollback;
- `model-platform-ci/artifact-keeper-image-pull` now exists as the
  repository-scoped read-only pull Secret. The live Tekton Pipeline still uses
  its verified 8889 digest until a separate node-by-node Artifact Keeper image
  migration is approved;
- stable HTTPS is still required before treating NodePort 30070 as a durable
  identity boundary.

## Resolved gates and remaining blockers

The following original release gates are now closed by the observed production
acceptance above: Gitea OIDC identity mapping to `User:default/gitadmin`, the
Backstage session Secret, the v0.2.9 image digest/architecture, namespace/PV
availability, repository-scoped Backstage and Tekton credentials, Gitea PR
status writing, and the real Gitea webhook delivery path. Do not recreate or
rotate those values merely by rerunning the historical commands below.

The remaining blockers before calling the full platform path complete are:

- stable internal HTTPS and a durable hostname for Backstage, Artifact Keeper,
  Gitea and Argo CD;
- node-by-node validation before moving live Tekton Task images from 8889 to
  Artifact Keeper `30670`, even though the namespace-local pull Secret already
  exists;
- manual Argo materialization of a reviewed stopped XR, followed by a
  separate, explicitly approved model-cache/NPU test window;
- optional retention cleanup of the three historical failed PipelineRuns and
  their report-status TaskRuns. This is not performed by this documentation
  update.

Secrets are entered only on `server-00`. They must not be returned to an Agent,
written into this repository or included in a release bundle.

## Stage 0 — read-only production baseline

Run on `server-00` and return only the output; these commands do not change the
cluster:

```bash
hostname
sudo k3s kubectl get node server-00 -o wide
sudo k3s kubectl get namespace \
  crossplane-system model-serving backstage \
  --ignore-not-found
sudo k3s kubectl get pods -A -o wide

sudo k3s kubectl get \
  functions.pkg.crossplane.io,compositions.apiextensions.crossplane.io
sudo k3s kubectl get modeldeployments.platform.example.com -A
sudo k3s kubectl get xrd modeldeployments.platform.example.com

sudo k3s kubectl get pv backstage-postgres-server-00 \
  --ignore-not-found
sudo k3s kubectl get storageclass backstage-postgres-local \
  --ignore-not-found
sudo ss -lntp | grep ':30070 ' || true
sudo test ! -e /mnt/data/model-platform/backstage/postgresql
echo "backstage_path_absent=$?"
df -hT /mnt/data
sudo k3s kubectl describe node server-00 \
  | sed -n '/Allocated resources:/,/Events:/p'
```

The expected baseline below is the historical pre-release baseline used before
the 2026-08-14 rollout. On a current production recheck it is expected that
the Backstage namespace/PV, Function, Composition and stopped proof instance
already exist; use the acceptance section above rather than treating the old
zero-object expectation as current state.

## Stage 1 — publish immutable inputs

### Mirror the Crossplane Function

Run on a host with `regctl` access to both registries. This writes only the new
internal Registry tag; it does not change Kubernetes:

```bash
regctl registry set 110.120.0.3:8889 --tls disabled
regctl image copy \
  xpkg.crossplane.io/crossplane-contrib/function-patch-and-transform@sha256:070fd3bdb56ec93f825e2f8fcda902bbdaef2e7831e164be5311144867f51dd8 \
  110.120.0.3:8889/platform/function-patch-and-transform:v0.8.2

regctl manifest digest \
  110.120.0.3:8889/platform/function-patch-and-transform:v0.8.2
regctl image inspect \
  110.120.0.3:8889/platform/function-patch-and-transform:v0.8.2 \
  --format '{{.OS}}/{{.Architecture}}'
```

The required digest is
`sha256:070fd3bdb56ec93f825e2f8fcda902bbdaef2e7831e164be5311144867f51dd8`
and the architecture must be `linux/amd64`.

### Historical v0.2.8 fallback build (reference only)

The following commands are retained only as the historical pre-v0.2.9 build
path. Do not rerun them for a new release: the active production image is
v0.2.9 in Artifact Keeper at the digest recorded above. Any future build must
use a new version, the Artifact Keeper `container-images` repository and a
newly verified Linux/AMD64 digest.

Run from the copied `backstage/app` build context on an explicitly identified
Docker-capable host:

```bash
docker build \
  --platform linux/amd64 \
  --file packages/backend/Dockerfile \
  --tag 110.120.0.3:8889/platform/model-platform-backstage:v0.2.8 \
  .
docker push \
  110.120.0.3:8889/platform/model-platform-backstage:v0.2.8

docker inspect \
  --format='{{index .RepoDigests 0}}' \
  110.120.0.3:8889/platform/model-platform-backstage:v0.2.8
regctl image inspect \
  110.120.0.3:8889/platform/model-platform-backstage:v0.2.8 \
  --format '{{.OS}}/{{.Architecture}}'
```

The image was rebuilt on `server-00` on 2026-08-14 after adding the Signals
frontend plugin and Events backend, which provide the frontend storage/signal
factory and the Scaffolder event bus. Docker returned
`sha256:e45fde00bf8a8f2b7d989a7f6bd2e5558ac1071376e62003e70a1d17e1522444`
and the local image is `linux/amd64`. Re-run the Registry verification before
release and stop if either value differs from the digest pinned in the manifest
and version lock.

## Stage 2 — Crossplane control-plane-only release

After bundle checksum verification on `server-00`, run the server-side dry-run
as one group:

```bash
sudo k3s kubectl apply --dry-run=server \
  -f crossplane/function-patch-and-transform.yaml
sudo k3s kubectl apply --dry-run=server \
  -f crossplane/composition/configmap-rbac.yaml
sudo k3s kubectl apply --dry-run=server \
  -f crossplane/composition/modeldeployment-control-plane.yaml
sudo k3s kubectl apply --dry-run=server \
  -f crossplane/xrd/modeldeployment-xrd.yaml
```

If all four pass, the production write group is:

```bash
sudo k3s kubectl apply \
  -f crossplane/function-patch-and-transform.yaml
sudo k3s kubectl wait \
  --for=condition=Healthy=True \
  function.pkg.crossplane.io/function-patch-and-transform \
  --timeout=10m

sudo k3s kubectl apply \
  -f crossplane/composition/configmap-rbac.yaml
sudo k3s kubectl apply \
  -f crossplane/composition/modeldeployment-control-plane.yaml
sudo k3s kubectl apply \
  -f crossplane/xrd/modeldeployment-xrd.yaml
```

Acceptance is Function `INSTALLED=True/HEALTHY=True`, XRD
`ESTABLISHED=True/OFFERED=True`, exactly one safe Composition, and zero XR:

```bash
sudo k3s kubectl get functions.pkg.crossplane.io
sudo k3s kubectl get compositions.apiextensions.crossplane.io
sudo k3s kubectl get xrd modeldeployments.platform.example.com
sudo k3s kubectl get modeldeployments.platform.example.com -A
sudo k3s kubectl get pods -n crossplane-system -o wide
```

Do not apply `crossplane/render/modeldeployment-example.yaml`.

## Stage 3 — Backstage release

Create only the dedicated data directory on `server-00`:

```bash
sudo install -d -o 999 -g 999 -m 0700 \
  /mnt/data/model-platform/backstage/postgresql
```

Create the namespace and the out-of-band Secret. Values are read silently and
unset immediately; return only the list of Secret key names:

```bash
sudo k3s kubectl apply -f backstage/kubernetes/namespace.yaml

read -rp 'Gitea OIDC client ID: ' BS_GITEA_OIDC_CLIENT_ID
read -rsp 'Gitea OIDC client secret: ' BS_GITEA_OIDC_CLIENT_SECRET
echo
read -rsp 'Backstage PostgreSQL password: ' BS_POSTGRES_PASSWORD
echo
read -rsp 'Backstage Gitea request token: ' BS_GITEA_REQUEST_TOKEN
echo
read -rsp 'Backstage session secret: ' BS_AUTH_SESSION_SECRET
echo

sudo k3s kubectl create secret generic backstage-secrets \
  --namespace backstage \
  --from-literal=POSTGRES_USER=backstage \
  --from-literal=POSTGRES_PASSWORD="$BS_POSTGRES_PASSWORD" \
  --from-literal=GITEA_OIDC_CLIENT_ID="$BS_GITEA_OIDC_CLIENT_ID" \
  --from-literal=GITEA_OIDC_CLIENT_SECRET="$BS_GITEA_OIDC_CLIENT_SECRET" \
  --from-literal=GITEA_REQUEST_TOKEN="$BS_GITEA_REQUEST_TOKEN" \
  --from-literal=AUTH_SESSION_SECRET="$BS_AUTH_SESSION_SECRET" \
  --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f -

unset BS_GITEA_OIDC_CLIENT_ID BS_GITEA_OIDC_CLIENT_SECRET \
  BS_POSTGRES_PASSWORD BS_GITEA_REQUEST_TOKEN BS_AUTH_SESSION_SECRET

sudo k3s kubectl get secret backstage-secrets \
  --namespace backstage \
  -o go-template='{{range $key, $value := .data}}{{$key}}{{"\n"}}{{end}}'
```

Now dry-run the dedicated storage and workload resources:

```bash
sudo k3s kubectl apply --dry-run=server \
  -f backstage/kubernetes/storage.yaml
sudo k3s kubectl apply --dry-run=server \
  -f backstage/kubernetes/postgres.yaml
sudo k3s kubectl apply --dry-run=server \
  -f backstage/kubernetes/backstage.yaml
sudo k3s kubectl apply --dry-run=server \
  -f backstage/kubernetes/rbac.yaml
sudo k3s kubectl apply --dry-run=server \
  -f backstage/kubernetes/network-policy.yaml
```

If they all pass, apply the reviewed Kustomize directory and wait:

```bash
sudo k3s kubectl apply -k backstage/kubernetes
sudo k3s kubectl rollout status \
  statefulset/backstage-postgres \
  --namespace backstage --timeout=10m
sudo k3s kubectl rollout status \
  deployment/backstage \
  --namespace backstage --timeout=10m
```

## Stage 4 — acceptance and regression

```bash
curl -fsS http://110.120.0.3:30070/healthcheck
sudo k3s kubectl get pods,svc,pvc -n backstage -o wide
sudo k3s kubectl get pv backstage-postgres-server-00 -o wide
sudo k3s kubectl logs -n backstage deployment/backstage \
  --since=10m --tail=200

sudo k3s kubectl auth can-i \
  --as=system:serviceaccount:backstage:backstage \
  get pods --namespace crossplane-system
sudo k3s kubectl auth can-i \
  --as=system:serviceaccount:backstage:backstage \
  get secrets --namespace crossplane-system
sudo k3s kubectl auth can-i \
  --as=system:serviceaccount:backstage:backstage \
  create deployments --namespace model-serving

sudo k3s kubectl get modeldeployments.platform.example.com -A
sudo k3s kubectl get pods -A -o wide
sudo k3s kubectl get events -A \
  --sort-by=.lastTimestamp | tail -80
```

Expected RBAC answers are `yes`, `no`, `no`. Sign in through GitHub, verify the
local catalog including the Qwen entity, and open the Kubernetes tab
for Backstage and Crossplane. Existing platform and NPU workloads must retain
their prior readiness/restart state.

## Stage 5 — isolated Gitea PR validation path

Git data files and the Tekton control-plane object have different release
destinations. First copy `gitops/repository/ci`,
`environments/production/catalog` and
`environments/production/modeldeployments` into a checkout of
`gitadmin/model-platform-config`, review the Git diff, commit and push them.
This makes the validator available to future PipelineRuns but does not change
Kubernetes.

Create the separate Tekton status token out of band on `server-00`:

```bash
read -rsp 'Gitea CI status token: ' GITEA_CI_STATUS_TOKEN
echo
printf '%s' "$GITEA_CI_STATUS_TOKEN" \
  | sudo k3s kubectl --namespace model-platform-ci \
      create secret generic gitea-ci-status-writer \
      --from-file=token=/dev/stdin \
      --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f -
unset GITEA_CI_STATUS_TOKEN

sudo k3s kubectl --namespace model-platform-ci \
  get secret gitea-ci-status-writer \
  -o go-template='{{range $key, $value := .data}}{{$key}}{{"\n"}}{{end}}'
```

In the Gitea repository webhook UI, retain the existing URL/secret and enable
both Push Events and Pull Request Events. Do not expose the webhook outside the
cluster. Then server-dry-run and apply only the existing CI Kustomize directory:

```bash
sudo k3s kubectl apply --dry-run=server -k tekton/ci
sudo k3s kubectl apply -k tekton/ci
sudo k3s kubectl get eventlistener,pipeline -n model-platform-ci
```

This updates the existing Gitea EventListener in place. It adds a PR trigger,
strict ModelDeployment validation and a final commit-status writer; it does not
restart or modify Artifact Keeper, Argo CD, Crossplane or NPU workloads.

## Stage 6 — manual Argo CD control-plane application

Apply these bootstrap objects only after the Function is Healthy, XRD Offered,
Backstage is Ready and a Gitea PR has passed Tekton:

```bash
sudo k3s kubectl apply --dry-run=server \
  -f gitops/modeldeployments-appproject.yaml
sudo k3s kubectl apply --dry-run=server \
  -f gitops/modeldeployments-application.yaml

sudo k3s kubectl apply -f gitops/modeldeployments-appproject.yaml
sudo k3s kubectl apply -f gitops/modeldeployments-application.yaml
```

Use the Backstage template to create one request. Before merge, verify the PR
contains exactly one new YAML file, the `tekton/model-platform-policy` status is
successful, and no ModelDeployment exists. After human merge, Argo CD must show
OutOfSync. Inspect its diff, then perform one manual Sync with prune disabled.

Acceptance after Sync:

```bash
sudo k3s kubectl get modeldeployments.platform.example.com \
  --namespace model-serving
sudo k3s kubectl get configmap \
  --namespace model-serving \
  -l app.kubernetes.io/component=deployment-request -o wide
sudo k3s kubectl get pods,jobs,pvc --namespace model-serving
sudo k3s kubectl get pods -A -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,NPU:.spec.containers[*].resources.requests.huawei\.com/Ascend910'
```

The expected result is one stopped ModelDeployment plus one status ConfigMap
whose `runtimeEnabled`, `cacheEnabled` and `npuRequested` values are false,
false and zero. There must be no new Deployment, Service, Job, PVC, Ray object
or NPU request. Do not manually edit the XR to `Running`; the XRD, CI schema and
Backstage action intentionally reject it in this phase.

## Mock scheduling form release gate

The updated Backstage source adds TP, PP, requested replica count and priority
fields. It is not production-visible until a new AMD64 image is built,
published to Artifact Keeper and explicitly rolled out. Before that rollout,
verify the generated request contains only the approved annotations and keeps
the effective values fixed to Qwen TP=6, replicas=0 and NPU=0. A form submission
must create only a Gitea PR; it must not call Kubernetes or start a model Pod.

## Rollback boundary

Backstage can first be scaled to zero without removing its data. Its PV uses
`Retain`; deleting a release object or namespace is not data cleanup. Crossplane
rollback is permitted only while XR count remains zero: restore the prior XRD
without composition references, then remove the Composition, aggregate role
and Function in reverse order. Any delete command is a separate destructive
change and requires explicit approval.
