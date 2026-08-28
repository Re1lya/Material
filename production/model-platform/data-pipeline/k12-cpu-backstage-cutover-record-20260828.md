# K12 CPU Backstage integration and service cutover record — 2026-08-28

## Outcome

The platform-managed K12 CPU release is now the only running Dagster control
plane. Backstage contains the constrained K12 Stage 1 page and backend API,
the legacy NodePort `30080` continuously routes to the new release, and the old
`mineru-dagster` Deployment is retained at zero replicas as the rollback
object. No NPU workload or data job was started during this stage.

Cutover completed at `2026-08-28T02:47:44Z` on `server-00`.

## Reviewed release input

The Backstage image was built from a detached clean worktree at Material
commit `defff9ca8cfc3fb1e03351a8fdd3fab2fd6d8fb0`. Only the following scoped
changes were copied into that context:

- the `dataPipeline` frontend page and tests;
- the `data-pipeline` backend plugin;
- frontend/backend plugin registration;
- `modelPlatform.dataPipeline` production configuration;
- K12 read-only RBAC.

Unrelated local Recipe, Artifact, Crossplane and Tekton changes were not in the
image build context.

Build validation completed successfully inside the Docker build:

- Yarn immutable install;
- TypeScript compilation;
- frontend build;
- backend bundle build.

The focused frontend test suite also passed locally (`3/3`).

Published image:

```text
110.120.0.3:30670/container-images/platform/kcc-backstage:0.1.0-cpu-integration-20260828@sha256:2496c46f0c2b3d8106bca08afc3e7a603c8c71014de6f580b2b7b8e865ce7ef3
```

The authenticated image inspection reported `linux/amd64` and the same remote
digest. The image was pushed with the repository-scoped KCC release identity,
not the registry administrator identity.

## Backstage production acceptance

- Deployment `backstage/backstage`: `1/1` Ready, zero restarts.
- The data-pipeline plugin appears in the backend initialization-complete log.
- `/data-pipeline` returns HTTP 200.
- The deployed static bundle contains `Launch controlled K12 CPU run`.
- An unauthenticated request to `/api/data-pipeline/status` returns HTTP 401;
  the API is not anonymously accessible.
- The Backstage ServiceAccount may `get` the K12 Dagster Deployment and
  RayCluster, but may not create Deployments in namespace `k12`.
- From the Backstage Pod, the pinned K12 Dagster `/server_info` endpoint returns
  HTTP 200 and repository discovery resolves `__repository__`, location
  `clean_qa.mineru_dagster.definitions`, with exactly seven pipelines including
  `cleanjopbstage1_10`.

The Backstage namespace has default-deny egress. A missing egress allowance was
found during live acceptance and fixed by adding
`backstage/backstage-to-k12-dagster`, restricted to TCP port 3000 in namespace
`k12`. The K12 ingress policy remains at its GitOps-defined selector boundary.

Interactive acceptance subsequently exposed a second default-deny detail:
K3s DNATs `kubernetes.default` (`10.43.0.1:443`) to the host-network API endpoint
`110.120.0.3:6443` before NetworkPolicy enforcement. The Backstage Kubernetes
API egress policy now permits only that exact endpoint and port. Live requests
from the Backstage Pod then returned HTTP 200 for both the Dagster Deployment
and RayCluster.

## UI layout follow-up

The data-pipeline, artifact-management and KCC pretraining pages were aligned
with the model-deployment page's full-width content rule (`maxWidth: none`,
zero auto margin, responsive page padding). Focused frontend tests passed
`12/12`, and the updated AMD64 release is:

```text
110.120.0.3:30670/container-images/platform/kcc-backstage:0.1.1-ui-layout-20260828@sha256:a6deb22c52e0ffabc614cc3f30420ada4cf6cc2f04a8c508e0d0eb9fc86c7798
```

The rollout completed `1/1 Ready`, zero restarts. From the replacement Pod,
both the Kubernetes Deployment request and Dagster `/server_info` returned
HTTP 200.

A second visual review identified the actual large-left-gap cause: the legacy
`ContentHeader` component had been placed as a direct child of Backstage's
three-column `Page` grid. CSS grid auto-placement assigned it to `pageNav`,
creating a wide empty navigation column and placing `Content` in the next
column. The data-pipeline, artifact-management and KCC pretraining headers are
now nested inside `Content`, matching the model-deployment page structure.
The corrected release supersedes the prior UI image:

```text
110.120.0.3:30670/container-images/platform/kcc-backstage:0.1.2-grid-fix-20260828@sha256:153b9bd93531ad8a03353370b80273843987012bf0501da28d553e74bebf37ea
```

Focused tests remained `12/12` passing; rollout completed `1/1 Ready`, zero
restarts, and Dagster connectivity returned HTTP 200.

The first authenticated launch click reached Backstage but returned HTTP 400
before contacting Dagster: the custom router had not installed an Express JSON
body parser, so `request.body` was undefined. The plugin now declares Express
directly and installs `json({ limit: '32kb' })` before its routes. TypeScript and
the complete frontend/backend build passed. The deployed fix is:

```text
110.120.0.3:30670/container-images/platform/kcc-backstage:0.1.3-json-body-20260828@sha256:9bb9154344cf3e52719619f6eda719834c9b38f3408c929f1fee87e63b52c710
```

The replacement Pod is `1/1 Ready`, zero restarts. No failed click was retried
automatically, and Dagster still reported zero active runs after rollout.

The final interactive acceptance was completed with a real
`user:default/gitadmin` Gitea OIDC session. Backstage displayed the Dagster
release, CPU Ray runtime and Dagster API as Ready, and launched the approved
10-document Stage 1 job successfully:

```text
runId: 51e7a011-2fb3-48e4-bd80-f3f875c82fd6
job: cleanjopbstage1_10
status: SUCCESS
elapsed: 50.3 seconds
request-name: backstage-stage1-sample
requested-by: user:default/gitadmin
profile: k12-stage1-clean-v1
npu-enabled: false
output-prefix: stage1/platform-smoke/backstage-stage1-sample
```

After completion Dagster reported zero active runs. The Dagster webserver and
daemon remained `2/2` Ready, and the Ray head and CPU worker remained Ready,
all with zero restarts. This closes the interactive CPU acceptance gate.

## State and cutover gates

Before cutover, both the old and new Dagster instances reported zero active
runs. Their migrated run databases matched:

```text
total=62, SUCCESS=43, FAILURE=17, CANCELED=2, active=0
```

The new canonical database is:

```text
/opt/dagster/dagster_home/storage/history/runs.db
```

The legacy compatibility Service `k12/mineru-dagster` was changed in place to
select the platform-managed Dagster labels. Its Endpoint became
`10.42.0.110:3000`, and both `127.0.0.1:30080/server_info` and
`110.120.0.3:30080/server_info` returned Dagster `1.13.13` before the old
Deployment was stopped.

After endpoint validation:

- `k12/mineru-dagster` Deployment was scaled to `0/0`;
- `k12-platform-cpu-k12-clean-qa-pipeline-dagster` remained `1/1`;
- the new Dagster Pod remained `2/2 Running`, zero restarts;
- the Ray head and CPU worker remained Running, zero restarts;
- NodePort `30080` continued to return `/server_info` successfully;
- NodePort GraphQL reported zero active runs;
- Argo Application `k12-data-pipeline` remained `Synced/Healthy`.

The old Deployment is intentionally not deleted. Rollback is recoverable by
restoring Service selector `app=mineru-dagster` and scaling that Deployment to
one replica. Because the platform release is now canonical, do not start both
Dagster daemons against divergent state during rollback.

## Remaining work

1. Commit/review the scoped Backstage source, image lock, RBAC and NetworkPolicy
   changes. The live release is already pinned to the recorded digest, but the
   current Material worktree remains intentionally uncommitted alongside user
   changes.
2. After an agreed observation period, delete the zero-replica legacy
   Deployment and its obsolete objects if rollback is no longer required. The
   legacy-named NodePort itself is now a documented K12 GitOps compatibility
   endpoint and may remain for client continuity.
3. CPU completion does not authorize NPU work. NPU profiles, Ascend resources,
   scheduling policy, images and NPU smoke remain a separate later phase.

## GitOps compatibility endpoint closeout

The legacy-named NodePort is now managed by the original K12 Helm/GitOps
release instead of remaining an orphaned live patch.

- KCC PR `#9`, `feat(data-pipeline): manage legacy Dagster endpoint`, merged to
  KCC main `52c9834a859e885e5bd596713cdaa8d28161788c`.
- The Chart adds an opt-in `dagster.compatibilityService`; the platform CPU
  profile enables only `mineru-dagster`, NodePort `30080`, selecting the
  platform-managed Dagster Pod.
- K12 source validation `k12-data-pipeline-validation-sscr6` and merged-main
  validation `k12-data-pipeline-validation-8rk8x` succeeded after the policy
  was tightened to allow exactly that one compatibility NodePort.
- Config PR `#9` added only the rendered Service and merged to
  `model-platform-config` main
  `4f7f461a31630ecd8d47d77b8fb7af8510813c50`.
- Independent config validation `k12-gitops-validation-kcnw4` succeeded. The
  generic config validator continued to fail only on the pre-existing Qwen
  ModelDeployment schema/Stopped-state findings and was not treated as a K12
  failure.
- Argo CD synchronized only `Service/k12/mineru-dagster`, with pruning
  disabled. Application `k12-data-pipeline` returned `Synced/Healthy` at the
  merged config revision.
- The Service now has the Argo tracking annotation, retains NodePort `30080`,
  resolves to the new Dagster endpoint, and `/server_info` remains HTTP 200.
- The old `mineru-dagster` Deployment remains `0/0` as the bounded rollback
  object; it was not deleted during this closeout.

With the compatibility Service governed and the interactive Backstage run
accepted, the CPU integration phase is complete. Remaining work is repository
review/merge of this Material record/source set and, after an observation
period, optional deletion of the zero-replica legacy Deployment.
