# Model platform agent handoff

This file is the mandatory starting point for any Agent continuing work in
this repository. It describes actual production state as of 2026-08-17 and the
rules for safely continuing the deployment.

## Mandatory operating rules

1. Never store, echo, commit or reproduce SSH passwords, Kubernetes
   tokens, Gitea credentials, Artifact Keeper tokens, private keys or other
   secrets in repository files, scripts, command output or documentation. Use
   an approved interactive or ephemeral credential mechanism when required.
2. Separate read-only diagnosis from production writes. Present the exact
   target, effect, rollback concern and validation before asking the user to run
   a write command.
3. Never modify unrelated namespaces or workloads. Do not create an NPU
   workload, RayService, model-cache Job, PVC, XR or `ModelDeployment` until the
   corresponding phase is explicitly approved.
4. Do not use bare `kubectl` or bare `helm` on `server-00`. The admin user's
   context is not production and may point to a remaining non-production Kind
   cluster; the old POC context was removed on 2026-08-14. Production commands
   must use `sudo k3s kubectl` and Helm must include
   `--kubeconfig /etc/rancher/k3s/k3s.yaml`.
5. Keep production synchronization manual. Argo CD prune and self-heal remain
   disabled unless a later reviewed decision explicitly changes this.
6. Publish every new image owned by the integrated platform to Artifact Keeper
   under `110.120.0.3:30670/container-images` and pin immutable digests. The
   legacy `110.120.0.3:8889` registry remains a compatibility source for
   already-running references and must not be bulk-migrated. Check architecture
   before release: the production control node is AMD64; the approved model
   runtime target is ARM64 Ascend and must use its own image.
7. Use Git as the source of truth for non-secret manifests. Do not commit
   rendered secrets, generated credentials, kubeconfigs or live object dumps.

## Collaboration and release workflow

### Host and account topology

Never use the ambiguous phrases "your machine", "Docker machine", "local
server" or `admin machine` in an operational instruction. Name the exact role
and host, or state that the host has not yet been selected.

The currently known topology is:

| Name | What it is | Confirmed responsibility | May an Agent operate it directly? |
|---|---|---|---|
| `jumper-0041-pub` | Current Agent/local workspace host | Material checkout at `/home/ilya/Desktop/Material`; local source editing and validation | Only through the provided local tools and workspace permissions; Docker availability/permission must not be assumed |
| `server-00` | Production K3s host/node, IP `110.120.0.3` | K3s control plane, production platform workloads, `/mnt/data`, internal Registry endpoint and Artifact Keeper NodePort | Yes, when the user explicitly authorizes this host and the operation remains inside the stated task scope |
| `a3-server-00` | Previously observed model-source host | Source copy of Qwen/DeepSeek model material | Only after separate explicit authorization for that host and task |
| `admin` | A Linux login account used in user-side remote command examples | Authenticated shell identity on a named host | It is not a hostname and does not identify where a command runs |
| authorized Docker build host | A role, not a known hostname yet | Has Docker permission, the reviewed build context, adequate disk/network, and access to the selected Registry endpoint | The user must identify it; the Agent may operate it when explicitly authorized |

At the start of any host-dependent phase, run this non-secret
identity/capability check on the authorized host, or ask the user to run it when
the Agent has no active remote access:

```bash
hostname
id -un
pwd
command -v docker || true
docker version --format \
  'client={{.Client.Version}} server={{.Server.Version}}' 2>&1 || true
```

This output identifies the host and whether the current user can reach the
Docker daemon. It does not authorize arbitrary remote access. The Agent then
uses the confirmed hostname in every subsequent instruction, for example
"run on `<confirmed-build-host>`" rather than "run on your Docker machine".

The direction of a copy command must also be explicit:

```text
scp SOURCE_HOST:/source/path /local/path
  = pull from SOURCE_HOST to the shell's current host

scp /local/path DESTINATION_HOST:/destination/path
  = push from the shell's current host to DESTINATION_HOST
```

Before either command, identify the current host, source host, destination
host, exact directory and expected checksum. The existence of a path on one
host says nothing about the same path on another host.

### Responsibility boundary

The Agent works in the local Material repository and on specifically authorized
remote hosts. The Agent is responsible for:

- reading the current plan, deployment records and Git status before editing;
- modifying Dockerfiles, scripts, schemas, Kubernetes YAML, Helm values and
  documentation under `/home/ilya/Desktop/Material`;
- preserving unrelated or pre-existing uncommitted changes;
- running local syntax checks, schema checks, `helm lint`, `helm template`,
  Kustomize rendering and Git diff review when the required tools are locally
  available;
- preparing a minimal release directory under `/tmp`, transferring it to an
  authorized host when needed, and running or providing exact dry-run, release
  and verification commands;
- reviewing sanitized command output, identifying the root cause of failures
  and deciding the next safe command;
- replacing temporary image digest placeholders only after verifying the
  internal Registry digest and target architecture;
- updating the Material deployment record only from observed production K3s
  evidence.

Remote and privileged work follows explicit authorization boundaries:

- the Agent may use SSH, SCP, SFTP or another remote-execution mechanism when
  the user explicitly identifies and authorizes the target host;
- authorization for one host or task does not authorize another host or an
  unrelated operation;
- the Agent must keep remote commands within the requested namespace,
  component and release scope, and must inspect targets before destructive
  actions;
- production writes that affect RBAC, CRDs/XRDs, Helm releases, PVCs,
  StatefulSets, databases, prune, rollback or NPU/runtime workloads still
  require the user's explicit approval;
- credentials must be supplied through an approved interactive or ephemeral
  mechanism and must not be written into repository files, shell history,
  process arguments, release bundles or logs.

When direct remote access is unavailable, provide the user with exact commands
and request only non-secret results. Never add credentials to a command merely
to make unattended access work.

### The four independent delivery layers

Do not describe a Git push as a deployment. The platform currently has four
independent delivery layers:

```text
Local Material repository
  -> design, source manifests, Dockerfiles, version locks and evidence
  -> GitHub push provides review/history only; it does not update K3s

Internal image registries
  -> Artifact Keeper 110.120.0.3:30670/container-images is the destination for
     every new integrated-platform image
  -> legacy Docker Distribution 110.120.0.3:8889 remains available for existing
     workload references during controlled migration
  -> Kubernetes consumes images only by reviewed immutable digest

Production Gitea: gitadmin/model-platform-config
  -> main push triggers the Tekton validation webhook
  -> Argo CD reads this repository, but current synchronization is manual

Production K3s on server-00
  -> Helm or kubectl release updates live control-plane objects
  -> no live update happens merely because Material was pushed to GitHub
```

An ordinary change may touch one or several layers, but each transition must
be explicit and independently validated.

### Standard local preparation phase

Before changing files, the Agent must inspect:

```bash
cd /home/ilya/Desktop/Material
git status --short
git branch --show-current
git log -3 --oneline --decorate
```

The Agent then:

1. identifies files already modified by the user and does not overwrite them;
2. makes only the scoped edits required for the current phase;
3. runs appropriate local validation;
4. checks that no secret or unresolved production placeholder is included;
5. shows the user the material effect, expected resource impact and remaining
   risk;
6. prepares a release bundle only after the local review passes.

Use `apply_patch` for local hand-written file edits. Do not commit unrelated
dirty-worktree files. A placeholder such as `REPLACE_WITH_*_DIGEST` may exist
during local preparation, but a manifest containing it must never be applied
to production or pushed to the production Gitea main branch.

### Preparing and copying a release bundle

The Agent should select only the files needed by the release and prepare a
versioned temporary directory, for example:

```text
/tmp/model-platform-release-YYYYMMDD/
```

The Agent records SHA256 checksums locally and may copy the bundle to an
explicitly authorized host, or give the user a copy command similar to:

```bash
scp -r /tmp/model-platform-release-YYYYMMDD \
  admin@server-00:/tmp/
```

The exact source directory and file list must be shown before copying. Do not
copy the whole Material repository when a small release bundle is sufficient.
Do not place credentials, `.git`, kubeconfigs, rendered Secrets or unrelated
working-tree files in the bundle.

After copying, ask the user to verify checksums on `server-00`:

```bash
cd /tmp/model-platform-release-YYYYMMDD
sha256sum ./*
```

The Agent compares this output with the local checksum list before giving any
release command.

### Building and publishing an internal image

Material stores the Dockerfile; Git does not build or publish the image. When
the local Agent environment cannot access Docker, use this workflow:

1. The Agent reviews the Dockerfile, its pinned base images, package versions,
   target architecture and build-time network requirements.
2. The Agent asks the user to copy only the build context to a machine with
   Docker permission and access to Artifact Keeper at `110.120.0.3:30670`.
3. The user runs the exact `docker build` and `docker push` commands provided
   by the Agent.
4. The user returns the pushed digest and architecture without credentials.
5. The Agent checks that the Registry digest and architecture match the
   intended platform, then updates local manifests from the placeholder to
   `tag@sha256:<digest>`.

Typical user-side commands are:

```bash
cd /path/to/copied/build-context
docker build \
  --platform linux/amd64 \
  -t 110.120.0.3:30670/container-images/<image>:<version> .
docker login 110.120.0.3:30670
docker push 110.120.0.3:30670/container-images/<image>:<version>

docker inspect \
  --format='{{index .RepoDigests 0}}' \
  110.120.0.3:30670/container-images/<image>:<version>

regctl manifest digest \
  110.120.0.3:30670/container-images/<image>:<version>
regctl image inspect \
  110.120.0.3:30670/container-images/<image>:<version> \
  --format '{{.OS}}/{{.Architecture}}'
docker logout 110.120.0.3:30670
```

If `regctl` is unavailable, the Agent must provide an equivalent read-only
Registry or Docker inspection command. A mutable tag alone is not sufficient
for a production manifest. Do not update the Pipeline or Kubernetes workload
until the immutable digest is known.

Publishing an image writes only to the internal Registry. It does not update a
Pod, Deployment, CRD, Tekton Pipeline or Argo CD Application. Rollback normally
means restoring the prior digest reference; deleting a Registry tag is not
required for rollback and should not be used as a casual cleanup step.

### Production dry-run and release phase

The Agent must give the user commands in small groups and explain what each
group proves. Production Kubernetes commands use:

```bash
sudo k3s kubectl ...
```

Production Helm commands always include:

```bash
--kubeconfig /etc/rancher/k3s/k3s.yaml
```

The normal sequence is:

1. verify target context, existing object/release and baseline health;
2. verify release bundle checksums;
3. run local/server `helm lint`, `helm template` or Kustomize render;
4. inspect kinds, images, resource requests, PVCs, RBAC and NPU requests;
5. run Kubernetes API server dry-run;
6. stop and review any warning, diff or unexpected object;
7. obtain explicit user approval for the final production write if it has not
   already been given for that exact phase;
8. run one scoped `helm upgrade --install` or `kubectl apply`;
9. wait for rollout and perform the acceptance checks below.

Examples of server-side dry-run commands are:

```bash
sudo k3s kubectl apply --dry-run=server -f <manifest>

sudo helm upgrade --install <release> <chart> \
  --namespace <namespace> \
  --values <values-file> \
  --kubeconfig /etc/rancher/k3s/k3s.yaml \
  --dry-run
```

Never copy a bare Helm command from the old Kind POC. Never delete or roll back
an object merely because a dry-run or rollout failed; first collect status,
events and bounded logs and determine whether a partial write occurred.

### Updating Tekton and the production Gitea repository

Tekton control-plane YAML and the files validated by Tekton currently travel
through different paths:

- Tekton `Pipeline`, Trigger, RBAC and policy objects are Material release
  manifests and are updated through reviewed `sudo k3s kubectl` release steps.
- Catalog, schema and validation files used by a PipelineRun must also be
  copied into the separate production Gitea repository
  `gitadmin/model-platform-config`.
- A push to Gitea main triggers Tekton CI. It does not by itself apply the
  Tekton Pipeline definition.
- Argo CD currently synchronizes only approved paths and only when the user
  initiates a manual sync; prune and self-heal remain disabled.

For a CI tools image update, use this order:

1. build and push the new image;
2. verify its immutable digest and architecture;
3. replace all digest placeholders in Material;
4. locally validate the Pipeline and catalog/schema scripts;
5. prepare and copy the Tekton release bundle;
6. run production server-side dry-run and apply the updated Pipeline;
7. copy reviewed catalog/schema files into the production Gitea checkout;
8. review the Gitea diff, commit and push main under the user's control;
9. inspect the webhook-created PipelineRun and its bounded logs;
10. confirm existing platform Pods have not restarted or degraded;
11. update deployment records and only then commit/push Material.

### Dual image registry policy

There are two internal image registries. Decision updated on 2026-08-13:
Artifact Keeper is the destination for every new image belonging to the
integrated platform; the legacy registry remains only for compatibility with
existing immutable references while consumers are migrated one at a time.

```text
Platform image destination       110.120.0.3:30670/container-images
  -> Artifact Keeper Docker-format OCI repository, quota 50Gi
  -> all new Backstage, Tekton/CI, Crossplane helper/function and other
     integrated-platform-owned images are published here
  -> server-00 K3s containerd is configured to reach it over internal HTTP

Legacy compatibility registry   110.120.0.3:8889
  -> existing workloads continue to use their current digest-pinned references
  -> do not re-tag, remove or bulk-switch those references
```

Rules:

1. Do not alter, re-tag or remove any image that already exists on
   `110.120.0.3:8889`. Existing workloads continue to consume 8889 by digest.
2. Publish new integrated-platform images to
   `110.120.0.3:30670/container-images/<image>:<version>`; verify architecture
   and immutable digest before a manifest references them.
   Temporary exception recorded on 2026-08-17: the two newly enabled Tekton
   Pruner images are currently in `110.120.0.3:8889/platform/` because no
   Artifact Keeper writer credential was available during the emergency-safe
   no-GHCR rollout. Do not treat that exception as the final policy; migrate
   both exact digests to Artifact Keeper before the next Operator upgrade.
3. Migrating an existing 8889 consumer is a separate reviewed release: copy
   or rebuild the image in Artifact Keeper, prove an authenticated pull in a
   disposable namespace, update exactly that consumer by digest, and retain
   its prior digest as rollback. Never switch all workloads at once.
4. The Artifact Keeper node endpoint uses Registry v2 over internal HTTP. On
   2026-08-13 `server-00` K3s was configured with an HTTP endpoint for
   `110.120.0.3:30670` in `/etc/rancher/k3s/registries.yaml`; the generated
   containerd `hosts.toml` contains the `/v2` HTTP host. This node-local setting
   must be repeated on every node that will pull these images. Crossplane Core
   additionally has a working cluster-internal HTTPS route and dedicated CA at
   `artifact-keeper-registry.artifact-keeper.svc.cluster.local`; it is used for
   xpkg resolution and does not yet replace node containerd registration.
5. Keep CI images amd64 (the production control node is AMD64). The ARM64
   Ascend model runtime remains on its verified current reference until its
   target node has equivalent Artifact Keeper registry and credential setup.
6. Use a dedicated repository-scoped read-only Artifact Keeper token in an
   `imagePullSecret` in each consuming namespace. Never use or commit an admin
   password. On 2026-08-17 an authenticated disposable Pod on `server-00`
   pulled `model-platform-ci-tools:v0.2.0` from Artifact Keeper by its expected
   immutable digest and completed successfully with only 10m CPU/16Mi memory
   requested and no Ascend resource. The temporary Pod was deleted. The
   Crossplane Function is the first live consumer and uses a dedicated read-only
   pull Secret. Other worker nodes remain unconfigured for the 30670 HTTP endpoint
   and must not receive
   Artifact Keeper-backed Pods until separately registered and tested.

Registration evidence and restart observations are recorded in
`production/model-platform/artifact-keeper-registry-registration-20260813.md`.

| Existing image | Current compatibility reference |
|---|---|
| model-platform-ci-tools v0.2.0 | `110.120.0.3:8889/platform/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd` |


Do not push a Gitea commit that requires a not-yet-published image or a
not-yet-applied Pipeline definition. CI runners remain unable to write Git,
trigger Argo synchronization or access Kubernetes credentials. The only
approved write-back is the separate repository-scoped
`gitea-ci-status-writer` credential used by the final Pipeline Step to update
the exact commit's `tekton/model-platform-policy` status; it cannot merge or
modify repository content.

### Priority runbook: dual Gitea/GitHub CI intake and GitHub-visible result

This is the platform-configuration intake foundation. Keep it intact while
implementing the higher-priority `ora-space/desktop` application CI described
below. Do not confuse the lightweight Material validation Pipeline with the
resource-intensive desktop build and test Pipeline. The goal here remains one
shared validation Pipeline with two isolated webhook entry points:

```text
Gitea main push (cluster internal)
  -> EventListener/model-platform-config
  -> CEL repository/ref filter
  -> shared TriggerTemplate and Pipeline

GitHub Material main push or same-repository pull request
  -> temporary HTTPS Cloudflare Quick Tunnel during integration
  -> EventListener/model-platform-github
  -> GitHub HMAC interceptor
  -> CEL repository/ref/action filter
  -> the same TriggerTemplate and Pipeline
  -> later, a separate final reporter returns the result to GitHub
```

The GitHub entry must not replace or broaden the Gitea listener. Each source
uses its own TriggerBinding, source URL, source root and trust policy. The
runner remains tokenless and this phase must not synchronize Argo CD, write
Git, build workloads, create storage or request NPU resources.

The prepared local files are:

- `production/model-platform/tekton/ci/triggers.yaml` — existing Gitea listener
  plus a separate signed GitHub listener for `Re1lya/Material`;
- `production/model-platform/tekton/ci/pipeline.yaml` — shared, source-aware
  validation Pipeline;
- `production/model-platform/tekton/ci/network-policy.yaml` — both listeners
  can reach interceptors, while only GitHub-labelled runs receive public
  TCP/443 clone egress;
- `production/model-platform/tekton/ci-tools/Dockerfile` — prepared CI tools
  image `v0.2.0`;
- `production/model-platform/tekton/README.md` — trust model and temporary
  Cloudflare integration path.
- `production/model-platform/tekton/pruner.yaml` and
  `pruner-installer-patch.json` — the enabled event-based Pruner policy and
  the generated InstallerSet patch needed to keep its images and Pods on
  `server-00`.

Production now runs CI tools `v0.2.0` from the immutable Artifact Keeper
reference
`110.120.0.3:30670/container-images/model-platform-ci-tools@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd`.
The namespace-local `model-platform-ci/artifact-keeper-image-pull` Secret is
repository-scoped read-only. The Pipeline and TriggerTemplate remain pinned to
amd64 `server-00`, where an authenticated disposable pull and a complete
validation Run succeeded; the previous 8889 digest remains the rollback
reference. Other worker nodes have not been registered for this endpoint.

#### Gate 1: build and publish CI tools v0.2.0

**Status: DONE on 2026-08-12.** Built on `server-00` with Docker
`--platform linux/amd64` and pushed to
`110.120.0.3:8889/platform/model-platform-ci-tools:v0.2.0`, remote
digest `sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd`,
verified as `linux/amd64` and content-checked (git 2.47.3, kubectl v1.35.0,
Python 3.12.13, check-jsonschema 0.38.0). The same image was also pushed to
the Artifact Keeper OCI repo `110.120.0.3:30670/container-images` with an
identical digest.

The authoritative Dockerfile currently has this checksum:

```text
497916aad1c267b034a0bacf95b62c76f978d22529973e66b09db730a2af1b9f
```

Its pinned stages are internal `library/python:3.12-slim` and
`kubectl:v1.35.0`, both intended for `linux/amd64`. It installs Git through
Debian apt and `check-jsonschema==0.38.0` through PyPI. Because external
Debian/PyPI access is slow on this network, the Dockerfile rewrites the apt
sources to `mirrors.ustc.edu.cn` (verified working for Debian trixie) and uses
`mirrors.aliyun.com/pypi/simple/` for pip (USTC and Tsinghua PyPI mirrors do
not carry `check-jsonschema`; Aliyun does). This is acceptable for the present
bootstrap, but it is not a fully reproducible high-assurance build: apt
packages and Python transitive dependencies are not locked by content hash.
Record that residual risk; a later hardening phase should use a locked
wheelhouse or hashes and an internally mirrored Debian/Python dependency path.

The preferred data flow is:

```text
reviewed local Material/ci-tools
  -> checksum-labelled minimal bundle
  -> user copies it to an authorized Docker build host
  -> build and push internal image
  -> verify the remote digest and architecture
  -> Agent replaces the placeholder in Material
```

The build used the release bundle under `/tmp/model-platform-release-20260812`
(synced to `server-00:/tmp/model-platform-release-20260812`), executed on
`server-00` with Docker. The `server-00` Docker daemon needed
`110.120.0.3:30670` added to `insecure-registries` (daemon.json, backup
`daemon.json.bak.20260812`) because Artifact Keeper serves OCI over plain HTTP;
the daemon was `systemctl reload docker`-ed with all containers kept running
(live-restore). Push used `docker login 110.120.0.3:30670` with the
repository-scoped `ci-image-publisher` token. The AK-side manifest digest and
OCI index media type were re-verified through the Registry v2 API after push.

Expected evidence was one remote `sha256:<64 lowercase hex>` digest and
`linux/amd64`, which was returned and verified. Publishing this tag changed
only the internal image storage; it did not update Kubernetes.

#### Gate 2: pin the digest and validate the complete local release

**Status: DONE on 2026-08-12.** Both `REPLACE_WITH_V020_DIGEST` occurrences in
`ci/pipeline.yaml` were replaced by the Agent with the then-active 8889 reference
`110.120.0.3:8889/platform/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd`.
The Agent, not the user, performs this source-of-truth edit. Verification performed:

1. there is no `REPLACE_WITH_` token anywhere in the release bundle;
2. all YAML documents parse and the Kustomize directory renders;
3. both EventListeners reference the same TriggerTemplate;
4. every TriggerBinding supplies all template parameters;
5. embedded POSIX shell parses;
6. the catalog/schema validator succeeds using the v0.2.0 image or an
   equivalent local environment;
7. no Secret object or secret value is present in Git;
8. no PVC, NodePort, Argo sync, Kubernetes runner token or NPU resource was
   introduced;
9. `git diff --check` passes and unrelated dirty-worktree files remain intact.

The Agent then prepares a minimal checksum-labelled release bundle containing
only the reviewed CI manifests. The user copies it to `server-00`, verifies
checksums, and returns only checksum/status output.

#### Gate 3: create the GitHub HMAC Secret without exposing it

The GitHub interceptor expects Secret
`model-platform-ci/github-webhook-secret`, key `secretToken`. This is a random
webhook HMAC value, not a GitHub PAT. It belongs only to the listener and is
never passed to a PipelineRun. The user chooses a high-entropy value and enters
the same value into the GitHub webhook UI and the interactive prompt below.
Do not pass it as a command-line literal, print it, return it to the Agent or
commit a rendered Secret:

```bash
read -rsp 'GitHub webhook HMAC secret: ' GITHUB_WEBHOOK_HMAC
echo

printf '%s' "${GITHUB_WEBHOOK_HMAC}" \
  | sudo k3s kubectl --namespace model-platform-ci \
      create secret generic github-webhook-secret \
      --from-file=secretToken=/dev/stdin \
      --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f -

unset GITHUB_WEBHOOK_HMAC
```

The safe evidence is metadata and key names only:

```bash
sudo k3s kubectl --namespace model-platform-ci \
  get secret github-webhook-secret \
  -o go-template='{{range $key, $value := .data}}{{$key}}{{"\n"}}{{end}}'
```

#### Gate 4: production dry-run, approval and scoped CI update

**Status: DONE on 2026-08-12.** Before the write, the user returned the
current Tekton, Gitea, Argo CD and Artifact Keeper readiness baseline (all
healthy, zero restarts). The Agent reviewed the rendered object list, images,
resource requests, RBAC and NetworkPolicies from the Kustomize render of the
reviewed bundle (734 rendered lines: 2 EventListeners, 6 NetworkPolicies, 3
TriggerBindings, 1 Pipeline, 1 TriggerTemplate). A server-side dry-run of the
rendered CI succeeded with no warnings. After explicit user approval, one
scoped `sudo k3s kubectl apply` of the rendered CI was executed; results
matched the dry-run exactly.

Acceptance evidence returned from production:

- Pod `el-model-platform-github-57f96dbf9b-hm84m` is `1/1 Running`, zero
  restarts; `/live` returns HTTP 200;
- EventListener `model-platform-github` is Available=True/Ready=True, Service
  `el-model-platform-github` (ClusterIP 8080) exists;
- existing EventListener `model-platform-config` and its Pod remain Running
  unchanged, zero restarts;
- Pipeline `validate-model-platform-config` now runs both Steps with
  `110.120.0.3:8889/platform/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd`;
- NetworkPolicies `allow-eventlisteners-to-interceptors` and
  `allow-github-clone-for-validation` applied; the former covers both
  listeners via matchExpressions;
- no PVC, no NodePort, no Secret introduced by the apply.

#### Gate 5: temporary Cloudflare Quick Tunnel and GitHub webhook

**Status: BLOCKED on cloudflared availability; path decided 2026-08-12.**

Quick Tunnel is permitted only for integration. It gives a random
`https://*.trycloudflare.com` URL, has no SLA, changes on restart and must not be
documented as the durable production endpoint. Do not add a public NodePort or
placeholder Ingress. On `server-00`, the user starts two long-running processes
in separate terminals:

```bash
sudo k3s kubectl --namespace model-platform-ci port-forward \
  service/el-model-platform-github 18080:8080 \
  --address 127.0.0.1
```

```bash
cloudflared tunnel --url http://127.0.0.1:18080
```

`cloudflared` is absent on `server-00`. Direct downloads were measured and
rejected: GitHub release download runs about 14.6 KiB/s (19 MiB package would
take 20+ minutes) and the official apt repo is also slow. The accepted path is
the internal Docker image: `cloudflare/cloudflared:2026.7.3` was already pulled
on `server-00` through the internal mirror accelerator `docker.1ms.run`
(digest `sha256:e39ee8da81ad5e05d77f38d2f51c60ca51bf2a8450ac3abab50c17fdb91d91bf`,
amd64, verified `cloudflared version 2026.7.3`). Next action: re-tag and push
that image to `110.120.0.3:8889/platform/cloudflared:2026.7.3` before starting
the tunnel.

In GitHub repository webhook settings the user selects JSON, supplies the same
HMAC value, subscribes only to push and pull-request events, and uses the
generated HTTPS URL. Return only delivery status codes, event type, timestamp
and redacted diagnostic text; never return headers containing signatures.

The first GitHub acceptance sequence is:

1. GitHub webhook ping/delivery is accepted;
2. a push to `main` creates exactly one GitHub-labelled PipelineRun at the
   exact 40-character `after` SHA;
3. an opened or synchronized same-repository PR targeting `main` creates
   exactly one run at `pull_request.head.sha`;
4. a wrong repository, wrong base branch, unsupported action, invalid HMAC and
   fork PR do not create a PipelineRun;
5. each accepted run completes bootstrap and catalog validation;
6. a new Gitea main push still creates and completes its normal run;
7. existing platform workloads remain Ready with no unexpected restart.

Stop both local processes when integration ends. This immediately removes the
temporary public route. Recreating Quick Tunnel changes the URL and therefore
requires updating the GitHub webhook.

#### Gate 6: return CI outcome to GitHub

Starting a PipelineRun is not the full requested GitHub CI closure. Completion
also requires developers to see a pending and final result on the commit/PR.
Implement this only after Gate 5 succeeds:

- use a separate reporter Task/finally Task that does not execute checked-out
  repository code;
- mount a least-privilege GitHub credential only into the reporter, never into
  clone/validation Steps and never into Gitea runs;
- first use one stable Commit Status context such as
  `tekton/model-platform-validation` with `pending`, `success`, `failure` or
  `error` on the exact webhook SHA;
- ensure the final report runs on validation failure and timeout;
- do not grant contents write, administration, workflow or package write;
- prefer a repository-installed GitHub App for the durable design; a narrowly
  scoped, expiring fine-grained token is acceptable only for bounded initial
  integration;
- do not expose raw Tekton logs publicly merely to populate `target_url`.

Only call the GitHub path complete when a developer can see the status on both
a push commit and a PR, a deliberate failing validation produces a visible
failure, no status is written for rejected webhook events, and credentials are
absent from logs and Task Pods that execute repository content.

#### Gate 7: replace Quick Tunnel with a durable endpoint

The durable follow-up is a named Cloudflare Tunnel or reviewed HTTPS ingress
with a stable hostname. A named Tunnel needs a dedicated token Secret, pinned
internal `cloudflared` image, non-root Deployment, probes, requests/limits,
restricted egress and an origin route only to
`el-model-platform-github.model-platform-ci.svc:8080`. This is an in-place
entry-point change, not a Tekton rebuild. Retain GitHub HMAC validation even
when Cloudflare protects the route.

Do not update the deployment record to say GitHub CI is deployed until the
corresponding production evidence has been returned. Local YAML, an image push,
a server dry-run or a Quick Tunnel URL alone is not completion evidence.

### Highest priority: `ora-space/desktop` GitHub PR CI

The next application workload is a GitHub-triggered Tekton Pipeline for
`https://github.com/ora-space/desktop`. It must visibly provide the requested
three main phases — clone, install and test — and return pending/final status to
the exact GitHub PR head SHA. This is a separate application CI path, not a
modification of the Material catalog-validation commands.

Repository inspection on 2026-08-12 established the following baseline:

- GitHub reports repository size `3754` KiB (about 3.7 MiB); the Git checkout
  itself is not the large transfer in this workload;
- `.gitattributes` contains text/EOL rules but no Git LFS filter;
- there is no `.gitmodules` file, so there are no submodules to fetch;
- it is a pnpm workspace spanning `apps/*`, `apps/web/client` and `packages/*`;
- the Rust workspace and the separate Tauri Rust project make dependency
  downloads and compilation much more expensive than the Git checkout;
- `Taskfile.yml` makes `task install` run pnpm/Cargo fetches and then a full
  Rust workspace build, while `task test` runs frontend, backend and desktop
  validation. Treat these commands as resource-intensive and audit their exact
  CI semantics before using them unchanged. In particular, CI formatting must
  be check-only and must not silently rewrite the checkout.

#### Network design: scoped outbound proxy, never a cluster-global proxy

The Clash Verge subscription URL is a credential-bearing configuration source,
not a proxy endpoint. A Task Pod cannot use the operator laptop's
`127.0.0.1:7890`. Do not paste or commit the subscription URL, and do not add
proxy environment variables to K3s, containerd, kubelet, Tekton controllers,
Argo CD or every namespace.

The recommended design is one dedicated Mihomo/Clash-core egress gateway
scheduled on `server-00`, exposed only as an internal ClusterIP Service. It may
live in a small `ci-egress` namespace. Use a pinned amd64 image mirrored into an
already pullable internal registry. Mount a sanitized exported configuration
from a Secret created interactively by the user; do not let an Agent request,
display, copy or store the subscription URL. Initial configuration updates are
manual Secret replacement plus a controlled proxy rollout, not an unaudited
in-Pod subscription updater.

Only the `ora-space/desktop` clone/install/test Steps and the isolated GitHub
reporter receive `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy` and `https_proxy`
pointing to the proxy Service. Prefer an HTTP CONNECT endpoint because Git,
pnpm, Cargo and `curl` consistently understand it. Set `NO_PROXY`/`no_proxy`
only after discovering the production Pod CIDR, Service CIDR and internal
endpoints; it must include localhost, `.svc`, `.cluster.local`, the Kubernetes
API, Gitea, Artifact Keeper and the internal image registry. Never blindly
copy a desktop `NO_PROXY` value.

NetworkPolicy must make this scope enforceable:

1. the application CI Task Pods can reach cluster DNS and the proxy Pod only;
2. they cannot directly reach arbitrary Internet addresses or unrelated
   cluster Services;
3. the proxy accepts traffic only from the approved CI namespace/service
   account labels and has the required public egress;
4. the EventListener remains an inbound component and does not inherit the
   build proxy or build credentials;
5. the Task service account has no Kubernetes API token (`automountServiceAccountToken: false`)
   and no deploy RBAC.

This keeps a proxy failure local to application CI. Container image pulls are
performed by containerd and therefore must continue to use internal images;
Task-level proxy variables do not solve image pulling. Cloudflare Tunnel is
the inbound GitHub-to-listener route and is unrelated to this outbound proxy.

Before releasing the proxy, the user returns only sanitized discovery output:
the actual Pod/Service CIDRs, CNI NetworkPolicy support, candidate internal
image digest/architecture, selected listening port, Service endpoints and a
probe result to `github.com`/`api.github.com`. Never return a proxy URL that
contains credentials, provider names, node addresses, subscription contents or
the Secret data. First acceptance uses a disposable curl Task Pod, then confirms
that the same Pod fails direct public egress when proxy variables are removed.

#### Checkout design: fresh shallow checkout, not a persistent worktree

Every PipelineRun receives a fresh `emptyDir` source workspace. Fetch the exact
webhook SHA with no tags and depth one; use protocol v2 and `--filter=blob:none`
when GitHub supports it. For PRs, fetch the PR head ref and verify that checked
out `HEAD` equals the webhook `pull_request.head.sha`. Never test an unverified
moving branch name.

Do not persist `node_modules`, a mutable checkout or a Git worktree between PRs.
Those make stale-file failures and cross-PR contamination likely. Because the
repository itself is small and has no LFS/submodules, do not introduce a bare
Git cache or Gitea mirror in the first release. Measure clone bytes/time first;
add an internal mirror only if measurements show clone remains material after
the scoped proxy is working. A future mirror must still guarantee that the
exact GitHub PR SHA is present before testing, including the special handling
required for fork PRs.

#### Dependency and compilation cache design

Use a separate bounded cache PVC; do not use that PVC as the source workspace.
The initial local-storage design may use one RWO cache PVC pinned to
`server-00`, because the current cluster is single-node. This is an explicitly
approved exception to the earlier tokenless no-PVC Material validation rule.
Start with one concurrent desktop PipelineRun and size the cache from the first
cold-run measurements rather than claiming a final production size upfront.
An initial planning envelope of 80-120 GiB is reasonable on this host, split by
directory and monitored:

- pnpm: persist the content-addressed pnpm store, never `node_modules`; pin the
  pnpm version compatible with the committed lockfile, run frozen-lockfile
  installs, and use `pnpm fetch` followed by an offline install where the
  workspace layout allows it;
- Cargo: persist only the useful Cargo download/index caches (`registry/index`,
  `registry/cache`, `git/db`) rather than an entire mutable Cargo home;
- Rust compilation: prefer a bounded `sccache` disk cache with
  `RUSTC_WRAPPER=sccache`; keep each run's `target` directory ephemeral to avoid
  cross-branch artifacts;
- add cache-size metrics and explicit eviction procedures. Cache deletion must
  be safe because every cache is reconstructible from lockfiles and upstream
  sources.

The upstream pnpm guidance explicitly treats restored package stores as
trusted caches. Therefore the first release accepts only pushes and
same-repository PRs from trusted contributors. Fork PRs are rejected before a
PipelineRun is created. Do not let untrusted PR code write a cache later
consumed by trusted release jobs. If fork CI is later required, give it an
isolated disposable cache and no secrets.

To avoid mounting one RWO cache across many TaskRun Pods, implement clone,
install and test as three visible Steps in one Tekton Task Pod. Steps share the
fresh source `emptyDir` and the bounded cache PVC while still producing separate
timings/results. Keep GitHub status reporting in a separate `finally` Task that
does not mount the source or cache and never runs repository code.

#### Pipeline behavior and GitHub reporting

Use a dedicated signed GitHub listener/Trigger for `ora-space/desktop`; do not
broaden the Material repository filter. Accept only `pull_request` opened,
reopened and synchronize events targeting `main`, plus an optional explicitly
approved `main` push path. Validate repository full name, action, base branch,
head SHA and fork status before creating a run. Limit initial concurrency to one
desktop run so CPU/RAM and the shared local cache remain predictable.

The Task image must be separately designed and pinned by digest. It needs the
repository-compatible Node/pnpm, Rust toolchain with rustfmt/clippy, `go-task`,
Git, CA certificates and the native libraries required by the Tauri tests. Do
not install these from the Internet at Pipeline runtime. Build once through the
reviewed local-file -> checksum bundle -> user copy -> internal build/push ->
digest verification workflow documented above.

The test Step initially records each sub-suite separately. Do not assume the
existing top-level `task test` is CI-safe until a local render/repository audit
confirms that formatting is check-only and generated files are verified with a
clean `git diff`.

The required PR user experience is a GitHub Check Run, not only a Commit
Status. Register a dedicated GitHub App and install it only on
`ora-space/desktop`. Minimum repository permissions are Metadata read, Pull
requests read and Checks read/write. Do not grant Contents write,
Administration, Actions, Workflows, Deployments or Packages write. Subscribe
only to the pull-request events needed by the Trigger (and optional push events
if the main-push lane is approved). Validate the App webhook with the separate
high-entropy HMAC secret. The App private key and webhook secret are different
credentials and must be different Kubernetes Secrets.

Use the App installation ID from the verified webhook/config and generate a
short-lived installation token inside each reporter Task. Do not store the
generated token in a Kubernetes Secret, Tekton Result, log, workspace or shell
history. Installation tokens expire after one hour and the implementation must
not assume they have a fixed length or legacy prefix.

The Pipeline has this reporting sequence:

```text
signed pull_request webhook for exact head SHA
  -> report-start Task creates Check Run "Tekton / ora-desktop"
       status: in_progress
       external_id: immutable PipelineRun UID
  -> ora-desktop-ci Task executes clone/install/test
       writes bounded machine-readable results, not credentials
  -> finally/report-finish Task always runs
       validates and caps the untrusted result document
       updates the same Check Run to completed
       conclusion: success/failure/timed_out/cancelled/action_required
```

`report-start` and `report-finish` use a dedicated digest-pinned reporter image,
receive the App ID/private key only through per-Step Secret mounts, and do not
execute checked-out repository code. The CI Task never receives the App private
key, installation token or webhook Secret. The reporter may reach only DNS,
the scoped proxy and the GitHub API; it receives no deploy RBAC. If the start
report cannot create the Check Run, fail closed before executing the expensive
CI job so a PR is never tested invisibly.

The CI Task writes a strictly bounded JSON result document under a unique
PipelineRun-UID report directory. The final reporter mounts only that report
subdirectory read-only, never the source checkout or dependency caches. Treat
the document as attacker-controlled even for same-repository PRs: enforce a
JSON schema, reject absolute/parent paths, cap total bytes, cap field lengths,
JSON-encode API requests without shell interpolation and ignore unknown fields.
If the CI Pod disappears before writing a valid document, the final reporter
derives an infrastructure conclusion from the Tekton task status and reports
that instead of skipping the Check.

The PR Check output must contain a compact Markdown summary:

- repository, PR number and verified 40-character head SHA;
- PipelineRun identifier and start/end timestamps;
- a clone/install/test table with outcome and duration for each phase;
- cold/warm cache indicator and pnpm/Cargo/sccache hit information when
  available;
- frontend, backend and desktop test counts and failure counts;
- a short infrastructure-error classification that distinguishes proxy,
  checkout, dependency, timeout and test failures;
- the first bounded failure excerpts, with secrets and control characters
  removed.

Generate structured source annotations where reliable formats exist: ESLint
JSON, clippy/rustc JSON diagnostics and Vitest/JUnit failures. Each annotation
must use a repository-relative path and validated line range. GitHub accepts at
most 50 annotations per API request; cap the first release at 50 total and add
an explicit "N additional diagnostics omitted" message rather than flooding
the API. Do not turn arbitrary stdout into annotations. Cargo tests without a
reliable source span remain in the Markdown summary.

Check lifecycle mapping is fixed:

- accepted and queued: create the Check Run immediately, then mark
  `in_progress` when the Pipeline begins;
- all clone, locked install and selected test suites pass: `success`;
- a source/lint/test assertion fails: `failure`;
- Tekton cancellation: `cancelled`;
- configured Pipeline timeout: `timed_out`;
- proxy, image pull, node, volume, malformed result or GitHub API failure:
  `action_required` when the Check can still be updated, otherwise retain a
  bounded controller alert for operator reconciliation.

Use the exact webhook head SHA in every Check API call. The Check name stays
stable as `Tekton / ora-desktop`, so it can later become a required branch
protection check only after repeated acceptance runs prove that webhook and
reporter failures cannot leave it permanently in progress. Do not initially
enable rerun buttons; that requires handling `check_run.requested_action` with
delivery deduplication and authorization and is a separate phase.

Do not publish the Tekton Dashboard or raw Pod logs to provide a `details_url`.
The Check summary and annotations are the initial developer-facing result. Keep
bounded internal logs according to a documented PipelineRun retention policy.
A later read-only authenticated log viewer may supply a stable `details_url`;
the temporary Cloudflare webhook endpoint is never a log URL.

#### Release sequence and acceptance gates

Proceed in batches, but preserve these gates:

1. audit and pin repository toolchain/test commands; render and lint locally;
2. deploy the scoped proxy gateway and prove proxied success plus direct-egress
   denial without changing global K3s networking;
3. create the bounded local cache PV/PVC and verify ownership, binding and free
   disk without touching Artifact Keeper/PostgreSQL PVs;
4. publish and verify the amd64 CI image by immutable digest;
5. server-side dry-run the dedicated listener, RBAC, policies, Task and
   Pipeline; obtain explicit user approval before the production apply;
6. run one manual cold PipelineRun, then one warm PipelineRun at the same SHA;
   compare clone bytes/time, dependency download bytes/time, cache sizes,
   install time, test time, CPU/memory peaks and result equality;
7. enable the signed GitHub App webhook and verify a real same-repository PR
   sees the `Tekton / ora-desktop` Check move from in-progress to a final
   conclusion with the phase table; a deliberate lint/test failure must produce
   failure plus at least one valid file annotation when the tool reports a
   reliable source span;
8. repeat one warm PR run and confirm no unexpected restarts or resource impact
   outside the CI/proxy namespaces.

The first release is complete only when warm runs reuse dependency/compiler
caches, every run still uses a clean verified checkout, proxy loss is reported
as infrastructure error, GitHub sees the final state on the exact PR SHA, fork
PRs cannot consume secrets/shared trusted caches, and existing Artifact Keeper,
Gitea, Argo CD, Tekton controllers, Crossplane and workloads remain healthy.

### Acceptance output the user should return

For each released module, ask for only the necessary sanitized evidence:

- Helm status/history with the explicit production kubeconfig, if Helm is
  involved;
- intended Pod/Deployment/StatefulSet readiness and restart counts;
- running image IDs and architectures;
- relevant CRD/XRD/Composition conditions;
- resource requests/limits and `kubectl top` observations;
- PVC/PV state only when storage is in scope;
- bounded Events and recent error/fatal/panic log matches;
- health endpoints or one constrained functional result;
- health and restart status of existing Artifact Keeper, Gitea, Argo CD,
  Tekton and Crossplane components.

The user must redact tokens, passwords, Secret values, cookies and private
repository credentials. The Agent should request key names, lengths or status
codes instead of secret values.

### Documentation and Git completion

After production acceptance, the Agent updates:

- the component deployment record;
- `production/model-platform/progress-20260810.md`;
- version locks and immutable image references;
- this handoff document if the workflow or safety boundary changed.

Before committing, run `git diff --check`, relevant renders/tests, a sensitive
value scan, `git diff --stat`, and a staged-file review. Commit only files in
scope. Push Material to GitHub only after the deployment record matches the
observed production result. A Material commit or GitHub push is audit and
source control; it is not evidence that production was changed.

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
7. `production/model-platform/crossplane/deployment-record-20260811.md` and
   `production/model-platform/crossplane/runtime-zero-deployment-record-20260814.md`
   — Crossplane Core bootstrap, internal HTTPS package path, Function,
   Composition and the zero-replica runtime proof.
8. `production/model-platform/catalog/` and
   `production/model-platform/cache/` — prepared model metadata, runtime profile
   and cache implementation; these files are not proof that runtime deployment
   has occurred.
9. `production/model-platform/qwen38-ray-mvp-plan-20260818.md` — the focused
   ModelScope -> Artifact Keeper -> KubeRay/Argo execution path for the
   user-reactivated Qwen3.8-27B test; it is a plan, not deployment evidence.
10. `production/model-platform/backstage/README.md` — minimum usable portal,
   identity, TLS, catalog, CI/CD connection, request-by-PR boundary and phased
   acceptance plan. It is a plan, not deployment evidence.
11. `production/model-platform/backstage/release-runbook.md` — exact staged
    user-run commands for the Crossplane, Backstage, Tekton PR-status and
    manual Argo control-plane closure.

Before editing, also inspect `git status`, the current branch and recent log.
Preserve unrelated user changes.

## Actual production state

The production target is the K3s cluster on `server-00`, Kubernetes
`v1.34.6+k3s1`. The old `kind-platform-poc-2` POC was decommissioned on
2026-08-14; its historical results must never be reported as production state.

| Module | Production state |
|---|---|
| Artifact Keeper | Running in `artifact-keeper`; 480Gi artifact PV + 20Gi PostgreSQL PV; Qwen model 24/24 files checksum-verified |
| Gitea | Running in `gitea`; private config repository and persistent PostgreSQL are verified |
| Argo CD | Running in `argocd`; one minimal manually synchronized Application; no prune/self-heal |
| Tekton | Operator, Pipelines, Triggers, both EventListeners and event-based `TektonPruner/pruner` Running; Gitea PR status path and GitHub listener deployed; CI tools now run from the Artifact Keeper digest on server-00; migration Run `model-platform-config-ak-migration-20260817` succeeded with Gitea status write; Pruner Pods are server-00-only with `gpu-*` count 0; previous 8889 digest retained for rollback |
| Crossplane | Core 2.3.4 Helm revision 2 and RBAC Manager Running; Function Patch and Transform v0.8.2 Installed/Healthy; control-plane foundation now applied (provider ServiceAccount/namespace Role+RoleBinding, no-NPU DeploymentRuntimeConfig, Qwen3.8 XRD and Composition); provider package/ProviderConfig remain gated and not installed |
| ModelDeployment API | v2 namespaced XRD Established/Offered; runtime-zero Composition installed; one stopped XR Synced/Ready |
| ModelVersion / RuntimeProfile | YAML catalog materials exist but are not yet backed by completed production APIs/controllers |
| Model cache | Fetcher and Job material exist; no production cache Job has run |
| Qwen runtime | No new production inference deployment has been created by this project. The reusable CPU-only BF16 importer, isolated ModelSlim W8A8 quantization contract, cache manifest-sidecar logic, provider-kubernetes/RBAC/Composition source and Qwen3.8 contract are prepared locally; the ModelScope candidate repository/revision, quantizer evidence, Artifact Keeper publisher/read credentials and final image/StorageClass evidence are not confirmed. |
| KubeRay / KCC pretraining | Existing KubeRay Operator v1.6.0 is `1/1 Ready` in `ray-mangement`; `ray.io/v1` RayCluster/RayCronJob/RayJob/RayService CRDs exist. KCC integration is explicitly deferred until its host scripts, paths, state/logs and kubeconfig dependency are migrated into K3s. Do not deploy another KubeRay Operator; a future platform `PretrainingJob` business Operator must reuse the existing one. |
| Backstage | Running in `backstage`; service/RBAC/OIDC/Catalog/events, constrained Gitea PR action and real exact-head policy status accepted; mock scheduling form rolled out; production runs v0.2.11 `linux/amd64` from Artifact Keeper at `sha256:5e779eaceeb6ab81b6a69547b5ad7f2f91fda291dfc09153ce4c7e5a81d3b698`; `artifact-keeper-backstage-pull` read-only Secret; Deployment and PostgreSQL Ready; NodePort 30070 health/form routes verified; no new ModelDeployment; effective model replicas remain 0; stable HTTPS and Ray dynamic scheduling remain future work. The KCC pretraining panel is mock/read-only and its training actions remain disabled. |

Crossplane Core and RBAC Manager declare 200m CPU and 512Mi memory requests in
total and use no PVC. The Composition Function adds 100m CPU and 128Mi memory
requests. The dormant model Deployment has zero replicas, so its template
requests do not create a Pod or reserve CPU, memory or NPU resources.

## Current connections

```text
Gitea main push -> Tekton EventListener -> validation PipelineRun
Gitea repository -> Argo CD repo-server -> manually synchronized bootstrap App
ModelScope BF16 -> CPU-only importer -> Artifact Keeper source -> isolated ModelSlim W8A8 quantizer -> Artifact Keeper final model artifact
Artifact Keeper internal HTTPS -> Crossplane Function/provider package resolution
Gitea ModelVersion/RuntimeProfile/ModelDeployment -> Tekton validation
Argo CD -> ModelDeployment XR -> Crossplane Composition -> provider-kubernetes
provider-kubernetes -> model-serving PVC/cache Job/stopped or Running RayService/Service
KubeRay -> RayCluster/Pods (not installed by this phase)

The first-stage importer and model release source remain local-only and no model
file has been processed in the current foundation step. The Crossplane
control-plane foundation is applied, but production still has no
provider-kubernetes package, ProviderConfig, ModelScope Qwen3.8 artifact, cache
Job, PVC, RayService or NPU workload from this track. The public candidate
`Qwen/Qwen3.8-27B` and its ModelSlim W8A8 support were not confirmed during the 2026-08-18 read-only preflight;
do not substitute Qwen3.6 without an explicit model decision.
```

There is not yet a production Tekton-to-Argo promotion path, Artifact Keeper
release publish Task, provider-kubernetes package or Crossplane-to-KubeRay runtime
path. The Qwen3.8 plan uses Argo CD only to submit a ModelDeployment XR; Crossplane
Composition/provider-kubernetes will combine the namespaced resources and KubeRay
will own the Ray lifecycle after the package/digest and stopped-XR gates pass.
Backstage is now deployed; its Gitea PR validation/status path and events
backend are installed, and a real Gitea PR delivery has passed exact-head
validation and status reporting.

### Tekton Pruner safety boundary (2026-08-17)

The event-based `TektonPruner/pruner` is now `Ready=True` and applies only the
seven-day/10-success/10-failure retention policy in `model-platform-ci`. Its
two controller/webhook Pods are pinned to `server-00`; the final production
check returned zero Pruner Pods on `gpu-*`, zero Pending Pods cluster-wide and
zero legacy Pruner CronJobs. It has no Ascend resource requests and does not
touch model Deployments, Ray workloads, PVCs or NPU cards.

Do not assume the standalone Operator v0.81 `TektonPruner.spec.config` selector
or image fields are propagated: the first reconciliation ignored them. The
generated `TektonInstallerSet` must be patched from
`production/model-platform/tekton/pruner-installer-patch.json`, and every
Operator/Pruner upgrade must repeat the node/image/Pending checks before being
accepted. The current two Pruner images are a documented temporary 8889
mirror exception; the final destination is Artifact Keeper 30670.

FastAPI work is a separate CPU-only application track. It should use exact-SHA
checkout, lock-file dependency installation, lint/type checks, tests and PR
status reporting in CI; merge/tag builds publish a digest-pinned image to
Artifact Keeper, and initial CD remains a manual Argo sync with prune and
self-heal disabled. Repository mirrors and lock-file-keyed dependency caches
are later scoped PVC/proxy changes, not part of the current model validation
Pipeline. The user reactivated the FastAPI track on 2026-08-17 for read-only
production discovery and deployment-plan documentation. No FastAPI namespace,
workload, Pipeline or release was created by that work. Implementation remains
gated on the exact source repository, lock/test/health contract and a reviewed
separate `fastapi-ci`/`fastapi` release. `ora-space/desktop` remains paused.

## Current execution order (updated 2026-08-18)

The user paused all `ora-space/desktop` work. Do not build its image, create a
new listener, run its Pipeline, deploy a proxy or consume its cache PVC in the
current phase. Existing Tekton, cache and tunnel objects remain untouched.

The Crossplane runtime-zero stage is complete in production:

```text
1. Function v0.8.2 is mirrored to Artifact Keeper and pinned by digest.
2. Crossplane resolves it through an internal HTTPS/CA path; Function is Healthy.
3. XRD is Established/Offered and runtime-zero Composition is installed.
4. One stopped XR is Synced/Ready and composes Deployment(0), Service, ConfigMap.
5. No Pod, Job, PVC, Ray object or NPU allocation was created; old Deployment is unchanged.
```

On 2026-08-18 the control-plane-only Qwen3.8 foundation was also applied:
provider ServiceAccount plus `model-serving` Role/RoleBinding, an amd64
server-00-only DeploymentRuntimeConfig, the XRD and the reviewed Composition.
This did not install provider-kubernetes, create ProviderConfig/XR resources or
touch model files. The next step is to mirror and audit the provider package,
then adopt the same foundation through the reviewed Gitea/Argo path; do not
create a stopped Qwen3.8 XR until that gate is complete.

Continue from this order:

```text
1. Put reviewed XRD/Composition/XR source into the production Gitea GitOps tree.
2. Add a narrowly scoped manual Argo CD Application; keep prune/self-heal off.
3. Update the existing Gitea EventListener/Pipeline with exact-head PR
   validation and `tekton/model-platform-policy` commit status reporting. DONE
   in production; synthetic and real close/reopen delivery paths have passed
   the validators and status writer.
4. Backstage catalog/reference validation, constrained request action and
   status feedback are DONE in production; the v0.2.11 Mock form records
   requested scheduling values but keeps effective replicas and NPU at zero.
5. Run the model-cache-only phase after separate node disk/network approval.
6. Activate a runtime only in an explicitly approved idle-NPU window.
```

The stopped XR is an infrastructure template, not a running inference service.
Do not scale its generated Deployment directly: Crossplane will reconcile it
back to zero, and any future activation needs a reviewed Composition/API
change plus NPU-capacity approval. The next RayCluster/RayService implementation
is an in-place extension, not a cluster rebuild.

## Backstage minimum usable closure

Backstage is the portal, not an additional deployment controller. Its first
production release includes Gitea OIDC login, catalog, links, narrowly scoped
Kubernetes reads and one custom Scaffolder action. That action is fixed to
`gitadmin/model-platform-config`, a single request directory, the verified
Qwen catalog references, `Stopped` and `control-plane-only`. It may create a
branch, file, PR and pending status. It must never merge, run `kubectl`, create
Pods/PVCs, select physical NPU cards, accept arbitrary images or proxy large
model uploads. Generic SCM publisher actions are not loaded.

The current source and v0.2.11 production image contain the Create-page
usability fix: the
model template is explicitly in the `default` namespace, provides an
`Open request form` card link, and sets `permission.enabled: false` for the
MVP. This avoids the standard Scaffolder card hiding **Choose** when the
browser cannot authorize `/api/permission/authorize`. It does not grant
Kubernetes writes: the custom action's initiator/model/profile allow-lists and
namespace-scoped RBAC remain in force. The v0.2.11 image has been rolled out
and the direct route is reachable through NodePort `30070`; browser-level
button visibility should be rechecked after refreshing the page.

Keep the two product paths separate:

- `ora-space/desktop` PRs run Tekton clone/install/test and report a GitHub
  Check. Main/tag builds publish installer/archive, checksum and SBOM artifacts
  to an Artifact Keeper generic repository. It is not deployed to K3s merely
  to call the process CD.
- Model deployment intent is created as a Gitea PR, validated by Tekton,
  reviewed and merged by a human, observed as OutOfSync by Argo CD, manually
  synchronized, and then rendered through Crossplane. NPU work remains behind
  an explicit capacity approval.

The first Backstage release is one application replica plus one PostgreSQL
replica and a 20Gi Retain PV. Planning requests are 500m CPU/1Gi memory for
Backstage and 250m/512Mi for PostgreSQL; re-measure the node before release.
Use Gitea OIDC, separate read/write integration credentials, stable HTTPS,
and a ServiceAccount that can only list/get/watch approved non-Secret objects
in approved namespaces. Full gates and acceptance checks are in
`production/model-platform/backstage/README.md`.

### Planned Backstage unified Gitea + Artifact Keeper MVP

This is planned work, not a deployed feature. The current portal still needs
manual Artifact Keeper API/token operations. The small next step is to add:

1. a read-only Artifact Keeper repository/format/quota/usage view;
2. a bounded form to create an approved Artifact Keeper repository;
3. a bounded Gitea project-repository form under the approved owner, recording
   the Artifact Keeper repository as catalog metadata;
4. a Backstage action that starts a Tekton artifact-publish PipelineRun.

The browser submits metadata only. It must never proxy multi-gigabyte models.
Tekton reads from controlled staging storage, injects a namespace-scoped
Artifact Keeper publisher Secret, performs resumable chunk upload and SHA256
verification, then reports status back to Backstage. The current Qwen source on
`a3-server-00` needs a separate staging/ingestion path before this action can
run; Backstage must not accept arbitrary SSH paths.

Planned credentials are separate: Artifact Keeper read/provision, Artifact
Keeper CI publisher, and Gitea project provisioner. Do not reuse the fixed
Gitea deployment-PR token, expose token values in the browser, or write them to
Git/logs/catalog. Repository deletion, arbitrary permission changes and
administrator-token issuance are disabled in the MVP. Validate the installed
Artifact Keeper 1.6.0 API against a disposable repository before production
write actions. These changes must not add Kubernetes, Ray, Crossplane or NPU
side effects.

## Recommended next deployment sequence

> 2026-08-13 update: `ora-space/desktop` is paused. Execute the safe Crossplane
> Composition and Backstage MVP described in "Current execution order" first.

1. ~~Define production schemas for `ModelVersion` and `ModelRuntimeProfile`, and
   extend Tekton validation for schema, immutable digest and cross-reference
   checks. Keep the CI ServiceAccount tokenless.~~ DONE 2026-08-12
   (schemas in `catalog/schema/`, `validate-catalog.py`, CI v0.2.0 with
   `validate-catalog` step; catalog files staged in the gitops repository tree
   but not yet pushed to Gitea/Argo).
2. ~~Pin, architecture-check and mirror the required Crossplane Composition
   Function image into Artifact Keeper.~~ DONE 2026-08-14.
3. ~~Install the Crossplane v2 Pipeline-mode runtime-zero Composition and
   validate the Offered API with one stopped XR, zero Pods and zero NPU
   allocation.~~ DONE 2026-08-14. No KubeRay permission or RayService was added.
4. ~~Build and deploy the read-only Backstage MVP: Gitea OIDC login, catalog,
   Kubernetes read-only status, constrained Gitea PR action and links.~~ DONE
   2026-08-14 with v0.2.9, and the v0.2.10 chooser fix was rolled out
   2026-08-17; the Mock scheduling form is deployed but its
   effective model runtime remains `replicas=0`, `NPU=0`.
5. Establish stable internal DNS/TLS for Artifact Keeper OCI, Gitea and
   Backstage. Prove digest-pinned HTTPS push/pull in a test namespace before
   migrating existing image consumers. The first Backstage health/catalog
   validation may use the temporary internal HTTP NodePort, but that endpoint
   is not the final public identity boundary.
6. Put reviewed XRD/Composition/catalog files into the production Gitea GitOps
   repository and add a narrowly scoped, manual Argo CD Application. Continue
   with no prune and no self-heal.
7. After the ModelDeployment API is Offered and the GitOps path is stable,
   enable only the Gitea-PR deployment-request action and verify that it cannot
   write Kubernetes directly.
8. Resume and finish the `ora-space/desktop` GitHub PR Pipeline only when the
   user explicitly reactivates that track.
9. For the user-reactivated Qwen3.8-27B task, follow
   `production/model-platform/qwen38-ray-mvp-plan-20260818.md`: freeze the
   ModelScope/artifact/runtime/cache contracts and render the final release
   unit first; do not create a disposable POC implementation.
10. Run the canary from that same release unit: ModelScope→Artifact Keeper→cache
    readback with zero NPU, then one RayService replica on `gpu-server-00`.
    Tekton validates Git only; Argo CD submits the ModelDeployment XR; the
    locked provider-kubernetes/Composition creates the cache and RayService;
    KubeRay executes the Ray lifecycle.
11. Promote only by changing the Git desired state/revision after the canary;
    no manual Pod edits or second implementation. Keep KCC pretraining
    integration deferred until the KCC control package is
    migrated into K3s. After that separate migration is accepted, define a
    platform `PretrainingJob` CRD and business Operator that emits RayJob and
    reuses the existing KubeRay v1.6.0. Do not deploy a second KubeRay Operator
    or grant Ray/NPU writes during the current phase.

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
