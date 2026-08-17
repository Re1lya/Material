# Artifact Keeper OCI registry registration record

Date: 2026-08-13  
Target: production K3s control node `server-00`  
Scope: register the Artifact Keeper OCI endpoint for K3s/containerd and verify
the change without migrating any live workload image.

## Registry roles

The platform has two image registries:

| Endpoint | Role |
|---|---|
| `110.120.0.3:30670/container-images` | Artifact Keeper Docker-format repository; mandatory destination for every new integrated-platform-owned image |
| `110.120.0.3:8889` | Legacy Docker Distribution registry; compatibility source for existing digest-pinned workloads during controlled migration |

Existing 8889 tags and manifests were not changed. No live Deployment,
StatefulSet, DaemonSet, Job or Tekton Pipeline image reference was migrated in
this operation.

## Change made

Before the change, `/etc/rancher/k3s/registries.yaml` contained only the 8889
HTTP mirror. A backup was saved as:

```text
/etc/rancher/k3s/registries.yaml.before-artifact-keeper-20260813
```

The following endpoint was then added and the YAML was parsed successfully:

```yaml
mirrors:
  "110.120.0.3:30670":
    endpoint:
      - "http://110.120.0.3:30670"
```

K3s was restarted once so its managed containerd could consume the new node
configuration. The generated containerd registry directory exists at:

```text
/var/lib/rancher/k3s/agent/etc/containerd/certs.d/110.120.0.3:30670/
```

Its `hosts.toml` routes Registry v2 requests to the 30670 HTTP endpoint. This
is a node-local configuration: every future K3s node that must pull Artifact
Keeper images needs equivalent configuration until the endpoint moves to
trusted HTTPS.

## Validation and observed impact

- Artifact Keeper `/v2/` was reachable and returned the expected registry
  authentication challenge.
- K3s returned active and `server-00` returned `Ready` after restart.
- The pre/post Pod count was 102 to 102.
- Crossplane RBAC Manager and KubeRay Operator each recorded one additional
  restart during the K3s restart and returned `1/1 Running`.
- Backstage was already rolling during the observation window; it was not
  modified as part of this registry change.
- A final cluster query found no Pod outside Running/Succeeded.
- Disposable test Pod and Secret objects were removed after the test.

## Authenticated-pull validation

On 2026-08-14 a newly supplied repository token authenticated successfully to
the Registry v2 API. A Restricted-Pod-Security-compliant disposable Pod was
then fixed to `server-00` and forced to pull:

```text
110.120.0.3:30670/container-images/model-platform-ci-tools:v0.2.0
image digest: sha256:e83607f17953aa25e94b3f3f071eae057f67adc77f600f0a492741c8fd58a7bd
```

The Pod reached `Succeeded`, reported the same image digest, and executed
`Python 3.12.13`. Its temporary Pod and `imagePullSecret` were deleted.

An initial unconstrained test was scheduled to `gpu-server-02` and correctly
failed because that node still attempted HTTPS. It was deleted without changing
the GPU node. This confirms that registry transport configuration is per-node:
only `server-00` is validated at this time.

Before any live manifest moves from 8889 to Artifact Keeper:

1. ensure the consumer has a permanent Artifact Keeper token with read access
   only to `container-images`; Backstage, Crossplane and `model-platform-ci`
   now have namespace-local pull Secrets, with the CI Secret named
   `artifact-keeper-image-pull`;
2. create or update the least-privilege `imagePullSecret` only in the real
   consumer namespace without writing the token to Git or shell history;
3. constrain the workload to `server-00`, or register and independently test
   every additional target node;
4. migrate one consumer by immutable digest with rollback retained. The
   server-00-constrained Tekton Pipeline is now the first CI consumer using
   Artifact Keeper; the previous 8889 digest remains available for rollback.

## CI pull-secret recheck — 2026-08-17

The new `ci-images-reader` read-only token was entered into
`model-platform-ci/artifact-keeper-image-pull`. A temporary Pod pinned to
`server-00` pulled the CI tools image from Artifact Keeper and completed with
the expected digest `sha256:e83607f1...`; it requested only `10m` CPU and
`16Mi` memory, declared no Ascend/NPU resource, and was deleted immediately.
The existing CI Listener Pods and cluster Pending count were unchanged. This
proves the credential and node pull path. The live Pipeline was then migrated
after a server-side dry-run and a scoped patch of only its four image fields;
the TriggerTemplate received the same Secret while retaining its existing
server-00/amd64 scheduling constraints.

## Live Tekton consumer validation — 2026-08-17

The manually created `model-platform-config-ak-migration-20260817` PipelineRun
completed with `Succeeded=True`. Its validation Task pulled the CI tools image
from Artifact Keeper and its final Gitea status Task logged
`gitea_commit_status=success`; the final Pod reported imageID
`110.120.0.3:30670/container-images/model-platform-ci-tools@sha256:e83607f1...`.
The Run used only `server-00`, requested CPU/memory only, and declared no
Ascend/NPU resource. Its completed validation Pod was deleted to release the
small `model-platform-ci` ResourceQuota; no existing Listener or application
Pod was touched.

## First live consumer and internal HTTPS package path

On 2026-08-14 the Crossplane Function became the first live
integrated-platform consumer of `container-images`; the server-00-constrained
Tekton CI Pipeline was migrated on 2026-08-17 as the next consumer. The
Crossplane runtime is pulled on
`server-00` from the registered 30670 endpoint with a dedicated read-only
Secret and immutable digest. Other existing 8889 consumers were not migrated.

Crossplane Core resolves the same Function xpkg through a separate
cluster-internal HTTPS route:

```text
artifact-keeper-registry.artifact-keeper.svc.cluster.local
```

That route is terminated by Traefik with a dedicated internal CA mounted into
Crossplane Core. It solves package-manager TLS without changing the node HTTP
endpoint. It is not yet a general external registry hostname and does not make
other K3s nodes trust or reach Artifact Keeper automatically.

## Rollback

If this endpoint registration itself must be reverted, restore the dated
registries file backup and restart K3s during a reviewed window. Revalidate all
nodes and Running workloads afterward. Restoring the registry configuration is
independent of deleting image content; do not remove images or registry tags as
part of configuration rollback.

The strategic hardening target is a stable
`https://registry.<internal-domain>` endpoint with a trusted certificate chain
on every K3s node. The current internal HTTP registration is an interim
operational configuration, not the final trust model.
