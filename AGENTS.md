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

## Collaboration and release workflow

### Host and account topology

Never use the ambiguous phrases "your machine", "Docker machine", "local
server" or `admin machine` in an operational instruction. Name the exact role
and host, or state that the host has not yet been selected.

The currently known topology is:

| Name | What it is | Confirmed responsibility | May an Agent operate it directly? |
|---|---|---|---|
| `jumper-0041-pub` | Current Agent/local workspace host | Material checkout at `/home/ilya/Desktop/Material`; local source editing and validation | Only through the provided local tools and workspace permissions; Docker availability/permission must not be assumed |
| `server-00` | Production K3s host/node, IP `110.120.0.3` | K3s control plane, production platform workloads, `/mnt/data`, internal Registry endpoint and Artifact Keeper NodePort | No SSH/SCP by the Agent; the user runs all commands |
| `a3-server-00` | Previously observed model-source host | Source copy of Qwen/DeepSeek model material | No; it is not automatically an authorized Docker build host |
| `admin` | A Linux login account used in user-side remote command examples | Authenticated shell identity on a named host | It is not a hostname and does not identify where a command runs |
| authorized Docker build host | A role, not a known hostname yet | Has Docker permission, the reviewed build context, adequate disk/network, and access to the selected Registry endpoint | The user must identify and operate it |

At the start of any host-dependent phase, ask the user to run and return this
non-secret identity/capability check on the proposed host:

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

The Agent works only in the local Material repository. The Agent is
responsible for:

- reading the current plan, deployment records and Git status before editing;
- modifying Dockerfiles, scripts, schemas, Kubernetes YAML, Helm values and
  documentation under `/home/ilya/Desktop/Material`;
- preserving unrelated or pre-existing uncommitted changes;
- running local syntax checks, schema checks, `helm lint`, `helm template`,
  Kustomize rendering and Git diff review when the required tools are locally
  available;
- preparing a minimal release directory under `/tmp` and giving the user exact
  copy, dry-run, release and verification commands;
- reviewing the sanitized command output returned by the user, identifying the
  root cause of failures and deciding the next safe command;
- replacing temporary image digest placeholders only after the user returns a
  verified internal Registry digest;
- updating the Material deployment record only from evidence returned from the
  production K3s cluster.

The user is responsible for all remote and privileged execution. The user:

- copies reviewed files to `server-00` with `scp` or another approved method;
- runs Docker commands in an environment with Docker permission;
- runs production `sudo k3s kubectl` and explicit-kubeconfig Helm commands;
- enters sudo, Registry, Git or application credentials interactively;
- returns command output after removing secrets or other sensitive values;
- gives explicit approval before a production write or a phase that creates
  storage, runtime workloads or NPU consumption.

The Agent must not open an SSH session, run SCP, use saved remote credentials,
or ask the user to paste a password or token. If a command prompts for a
credential, instruct the user to enter it locally and return only the
non-secret result.

### The four independent delivery layers

Do not describe a Git push as a deployment. The platform currently has four
independent delivery layers:

```text
Local Material repository
  -> design, source manifests, Dockerfiles, version locks and evidence
  -> GitHub push provides review/history only; it does not update K3s

Internal Registry: 110.120.0.3:8889
  -> docker build/tag/push publishes runtime content
  -> Kubernetes consumes images by immutable digest

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

The Agent records SHA256 checksums locally and gives the user a copy command
similar to:

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
   Docker permission and access to `110.120.0.3:8889`.
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
  -t 110.120.0.3:8889/platform/<image>:<version> .
docker push 110.120.0.3:8889/platform/<image>:<version>

docker inspect \
  --format='{{index .RepoDigests 0}}' \
  110.120.0.3:8889/platform/<image>:<version>

regctl manifest digest \
  110.120.0.3:8889/platform/<image>:<version>
regctl image inspect \
  110.120.0.3:8889/platform/<image>:<version> \
  --format '{{.OS}}/{{.Architecture}}'
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

### Dual image source policy

Runtime and CI images are served from two internal sources. Decision on
2026-08-12: the active mainline uses the legacy 8889 registry; the Artifact
Keeper OCI repository is provisioned but deferred.

```text
Active image source              110.120.0.3:8889
  -> primary for all runtime/CI images consumed by K3s, including
     model-platform-ci-tools:v0.2.0; K3s containerd already mirrors it over HTTP

Deferred image source            110.120.0.3:30670/container-images
  -> Artifact Keeper OCI repo provisioned (docker format, repo container-images,
     publisher token ci-image-publisher, quota 50Gi). v0.2.0 was pushed there
     too and is identical by digest. K3s containerd is NOT configured to pull
     from 30670, so nothing running may reference it yet.
```

Rules:

1. Do not alter, re-tag or remove any image that already exists on
   `110.120.0.3:8889`. Existing workloads continue to consume 8889 by digest.
2. The active mainline reference for new images stays on 8889 so K3s can pull
   without a cluster registry change.
3. A new image is published to 8889 and, if also wanted for the deferred AK
   path, copied to `110.120.0.3:30670/container-images` with the same digest.
   References in manifests stay on 8889 until the AK/K3s registry switch is a
   separately reviewed change.
4. The Artifact Keeper OCI repository uses Docker Registry v2 over plain HTTP
   on `110.120.0.3:30670`. The `server-00` Docker daemon has that address in
   `insecure-registries` (daemon.json, backup `daemon.json.bak.20260812`) so
   manual `docker login/push` works over HTTP. Switching K3s to pull from AK
   requires adding 30670 to `/etc/rancher/k3s/registries.yaml` and restarting
   K3s; that is deferred.
5. Keep CI images amd64 (the production control node is AMD64). The ARM64
   Ascend model runtime image stays on 8889 and is not affected by this policy.

| Image | Active reference |
|---|---|
| model-platform-ci-tools v0.2.0 | `110.120.0.3:8889/platform/model-platform-ci-tools:v0.2.0@sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd` |


Do not push a Gitea commit that requires a not-yet-published image or a
not-yet-applied Pipeline definition. Do not let CI write back to Git, trigger
Argo synchronization or access Kubernetes credentials unless a later phase
explicitly designs and approves those permissions.

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

Production currently still runs CI tools `v0.1.0`. CI tools v0.2.0 was built
and published to 8889 (active reference) and also copied to the deferred AK
OCI repo with the same digest. The local Pipeline must still be applied to
production with the 8889 digest pinned.

#### Gate 1: build and publish CI tools v0.2.0

**Status: DONE on 2026-08-12.** Built on `server-00` with Docker
`--platform linux/amd64` and pushed to
`110.120.0.3:8889/platform/model-platform-ci-tools:v0.2.0`, remote
digest `sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd`,
verified as `linux/amd64` and content-checked (git 2.47.3, kubectl v1.35.0,
Python 3.12.13, check-jsonschema 0.38.0). The same image was also pushed to
the deferred AK OCI repo `110.120.0.3:30670/container-images` with an
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
`ci/pipeline.yaml` were replaced by the Agent with the active 8889 reference
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

## Current execution order (decision 2026-08-12)

The platform has two active CI tracks. Track B (`ora-space/desktop`) is the
highest priority. The user ordered the work as: complete the GitHub webhook
entry and the PV/PVC cache first, and defer the scoped proxy gateway to the
last step. Do not reorder without explicit user approval.

```text
Track A: Material validation CI (foundation, mostly done)
  Gate 1-4 DONE. Gate 5 partially done: cloudflared image mirrored to 8889
  (sha256:b392761b... amd64), port-forward + Quick Tunnel RUNNING
  (https://complications-magnificent-segments-blvd.trycloudflare.com,
  temporary URL, changes on restart), GitHub webhook configured (ping 202,
  green), PR #6 triggered a GitHub-labelled PipelineRun
  (model-platform-config-validation-rxd7x, revision = PR head SHA
  ab84e54d..., Succeeded, bootstrap_validation=PASS).
  Remaining: Gate 5 acceptance items 4-7 (negative tests), then Gate 6/7.

Track B: ora-space/desktop GitHub PR CI (highest priority)
  1. GitHub webhook entry (own EventListener, own TriggerBindings, HMAC) - NOT
     STARTED; the Track A tunnel/listener pattern will be reused
  2. PV/PVC cache - DONE 2026-08-12: StorageClass ora-desktop-cache-local,
     PV ora-desktop-cache-server-00 (100Gi RWO Retain,
     /mnt/data/model-platform/ci-cache), PVC
     model-platform-ci/ora-desktop-cache, all Bound. Manifest:
     tekton/ci/cache-storage.yaml
  3. CI image ora-desktop-ci (amd64, digest-pinned, Node/pnpm + Rust
     toolchain + go-task + Tauri libs) - IN PROGRESS: repository toolchain
     audit blocked; git clone of ora-space/desktop via github.com is too slow
     (TLS drop / <1 B/s), curl tarball via codeload was being tested when the
     session was paused. Remaining: confirm Node/pnpm/Rust versions from
     package.json / Taskfile.yml / rust-toolchain.toml, then build the image.
  4. Pipeline/Task clone/install/test single Pod, fresh emptyDir source,
     bounded cache PVC - NOT STARTED
  5. GitHub App + Check Run reporter (report-start/report-finish, checks
     read/write only) - NOT STARTED
  6. Scoped proxy gateway LAST (ci-egress, Mihomo/Clash-core, ClusterIP
     Service, HTTP CONNECT, only Task/reporter Steps use proxy env)
  7. Acceptance: cold vs warm run, real PR Check, regression health
```

Network reality on 2026-08-12: server-00 direct egress to github.com
(git clone endpoint) is very slow (TLS drops, <1 B/s sustained), while
codeload.github.com tarball download measured 147 KiB/s and api.github.com
answered 200 in ~7s. registry.npmjs.org answered in ~1.1s and
static.crates.io was reachable. A proxy may still be needed for reliable git
clone and for pnpm/Cargo payload downloads; measure before deciding.

The deferred proxy does not block the first shallow-clone measurement: the
repository is only 3.7 MiB with no LFS and no submodules, so a direct
`--depth 1 --filter=blob:none` clone may be feasible without a proxy. Measure
first; deploy the proxy only if clone/install measurements require it.

## Recommended next deployment sequence

> 2026-08-12 update: step 1 below is DONE (schemas + validator + CI v0.2.0
> validation). The active work is the `ora-space/desktop` track in "Current
> execution order" above; this list is the platform track and resumes after
> the CI tracks.

1. ~~Define production schemas for `ModelVersion` and `ModelRuntimeProfile`, and
   extend Tekton validation for schema, immutable digest and cross-reference
   checks. Keep the CI ServiceAccount tokenless.~~ DONE 2026-08-12
   (schemas in `catalog/schema/`, `validate-catalog.py`, CI v0.2.0 with
   `validate-catalog` step; catalog files staged in the gitops repository tree
   but not yet pushed to Gitea/Argo).
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
