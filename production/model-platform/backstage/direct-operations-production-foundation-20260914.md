# Direct Operations production foundation — 2026-09-14

## Current result

The non-NPU Direct Operations production foundation is deployed. The actual
model Start acceptance was deliberately not run because all 16 A3 device IDs
were occupied by active host `python3.10` processes.

The Running Window remains closed and `qwen38-27b` remains Stopped. No Ray,
vLLM, cache, PVC, or NPU workload was created by this release work.

## Rollback point

The pre-release live objects are preserved under
`rollback/direct-operations-pre-release-20260914/`.

Verified old Backstage image:

`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.1-personal-wandb-c937370@sha256:0468a270b484b441a62677f430e3ba70a5aece4cb2974c914e27abf6de68a703`

It was pulled successfully from Artifact Keeper immediately before the
release. A forced rollback from the broken intermediate candidate to the last
healthy image completed in seconds, proving that the image rollback path is
operational.

## Source and production image

Backstage fixes:

- PR `gitadmin/platform-backstage#7`: register the packaged Direct Operations
  module in the overlay runtime;
- PR `gitadmin/platform-backstage#8`: package the CommonJS
  `modelPlatformGitea.js` dependency alias and require the Direct Operations
  module during the image build;
- resulting Backstage main:
  `7b374390f284bdb7983072e60b32f0f9b68024bd`.

Current production image:

`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.15-direct-operations-packaging-7b37439@sha256:0391260f3ea95df357751dc2a455453f46fe36d20516820817eae9cde1da6a92`

The Pod is Ready with zero restarts. The training catalog and model deployment
status endpoints return HTTP 200. The Direct Operations endpoint now exists
and returns HTTP 401 to an unauthenticated request instead of HTTP 404.
Direct Operations remains disabled by configuration.

Do not use the intermediate image
`0.6.14-direct-operations-runtime-6279187@sha256:0c49b75f4ae0f472f9c2430735fd7146d081bf2d0db46da727657b268a6b9763`:
it registers Direct Operations but lacks the local CommonJS dependency alias
and therefore CrashLoops. Production was rolled back before the fixed image
was built.

## Configuration and database

Configuration repository production assets were merged before this work as
`0227e30cb9317949eaf14ee2580e87515188c37e`. Additional fixes:

- PR `gitadmin/model-platform-config#52`: add the minimal DNS/PostgreSQL
  NetworkPolicies required by the one-shot migration Job;
- PR `gitadmin/model-platform-config#53`: read metrics from the allow-listed
  A3 exporter Pod IP over NetworkPolicy-bounded TCP/8082 and remove
  `pods/proxy` RBAC;
- resulting configuration main:
  `e815488d0729c714b1e1eed9de2beca11fbde89b`.

The first migration attempt failed before connecting to PostgreSQL with
`EAI_AGAIN`; no table was written. After the NetworkPolicy fix, the retry
reported `model_deployment_migration=PASS`. Verified tables:

- `model_deployment_configs`;
- `model_deployment_locks`;
- `model_deployment_operations`.

The lock row for `qwen38-27b` exists. The migration is additive and
transactional.

The capacity checker Deployment is Ready. The cache reaper CronJob remains
`suspend: true`; one manually created validation Job reported
`cache_reaper=PASS deleted=none` and was then deleted.

## A3 network recovery and capacity evidence

After the A3 reboot, firewalld was active but the K3s pod-network and kubelet
ports were not allowed. This caused cross-node Pod traffic, exporter scraping,
pod-proxy requests, and log access to time out.

The following runtime and permanent firewalld rules were added without
restarting A3 or touching its NPU processes:

- public rich rule: allow `8472/udp` from `110.120.0.0/16`;
- public rich rule: allow `10250/tcp` from `110.120.0.3/32`;
- trusted sources: `10.42.0.0/16`, `10.43.0.0/16`;
- the pre-existing trusted source `10.253.0.2/32` was also persisted.

After the pod-network rule, server-00 read the A3 exporter metrics endpoint in
about 2.8 seconds. The updated capacity checker returned HTTP 200 with
`allowed=false` and active device IDs `0` through `15`, matching direct
`npu-smi info` evidence. This is the intended fail-closed result.

Kubernetes `pods/log` through the kubelet tunnel can still time out. Do not
restart `k3s-agent` while the current host NPU jobs are active; repair and
verify that path in a maintenance window before claiming the worker log chain
is complete.

## Remaining production acceptance

The enablement-only candidate is prepared but intentionally not merged or
deployed while A3 is occupied:

- PR: `gitadmin/platform-backstage#9`;
- source: `023902eb231e86449347694f872d0a64ddbf5508`;
- image:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.16-direct-operations-enabled-023902e@sha256:5c24de92f3bac55be60926b7995a4c0893d5b7641e91c272c56b5aa6914da911`;
- allowed initiator: only `user:default/gitadmin`.

The image build verified that Direct Operations is enabled in the candidate,
the runtime registration exists, and the packaged module and its local
dependency load successfully. Production continues to run the feature-off
`0.6.15` image.

When A3 is genuinely idle:

1. verify the capacity checker returns `allowed=true` for the approved TP=2
   request;
2. confirm the Running Window is still closed, then open it by the reviewed
   procedure;
3. enable Direct Operations only for `user:default/gitadmin` using an audited
   production configuration override;
4. save a parameter version, issue Direct Start, and verify operation phases,
   Ray/vLLM health, EndpointSlice and `/v1/models`;
5. run one real chat request;
6. issue Direct Stop, confirm all serving resources are removed and retained
   cache policy is respected;
7. close the Running Window and keep the legacy GitOps path as rollback.

## Acceptance continuation — later on 2026-09-14

The A3 pool was initially confirmed idle by both the capacity checker and
direct `npu-smi`. The following additional preparation was completed without
starting the model:

- `k3s-agent` was restarted while A3 had no business Pod or NPU process; the
  node returned Ready. The kubelet `pods/log` tunnel can still time out, so
  direct A3 inspection remains the bounded log fallback for this acceptance.
- live `qwen38-27b` Argo tracking and client-side last-applied annotations were
  removed; `app.kubernetes.io/managed-by` became `backstage`. The XR generation
  remained 79 and the spec remained `Stopped / modeldeployment-stopped-v2`.
- PR `gitadmin/model-platform-config#54` corrected the migration target to
  Backstage's plugin-isolated database
  `backstage_plugin_model-deployment-operations`.
- PR `gitadmin/platform-backstage#10` added the bounded JSON body parser.
- PR `gitadmin/platform-backstage#11` aligned ModelVersion loading with the
  production catalog, where `modelId` and `revision` are top-level spec fields.
- PR `gitadmin/platform-backstage#12` moved dependency installation ahead of
  source/config copies so future source-only image builds can reuse the
  dependency layer.
- PR `gitadmin/model-platform-config#55` granted Backstage only `get` on the
  named `model-platform-running-gate-policy` ConfigMap.

Current source baselines:

- Backstage main: `60ecc660e0a9d7abb852889942ec1740dce0bd2e`;
- configuration main: `900c4b5da507a999f199f438794120c5dae976ec`.

Current production Backstage image:

`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.18-direct-operations-contract-60ecc66@sha256:97a13db59301cec4c87fdf97c0537d8b09158a1ca1ee2bd44c88f02ed43f0026`

Authenticated Direct Operations evidence:

- GET configurations: HTTP 200;
- save production TP=2 configuration: HTTP 201, configuration version 1;
- first Start attempt: safely failed before XR patch because the running-gate
  ConfigMap permission was absent; the operation was recorded as Failed and
  PR #55 corrected the missing permission.

Before the final retry, a new Docker container named
`kt-r6-deferred-ascend` was detected on A3. Its `sglang::scheduler` process was
defunct but still retained about 30 GiB on chip 0 according to the driver.
The capacity checker correctly changed to `allowed=false`. The Running Window
was already closed, the XR remained generation 79 and Stopped, and no Direct
Start was retried. Do not stop or remove that container without its owner's
approval; resume only after both the driver process table and the capacity
checker report idle again.
