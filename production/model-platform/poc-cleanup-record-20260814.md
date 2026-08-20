# Legacy Kind POC cleanup record

## Scope

Cleanup target:

```text
Kind cluster:  kind-platform-poc-2
Kube context:  kind-kind-platform-poc-2
Host:          server-00
```

This was the old CPU POC and was not the production K3s cluster. Production
K3s remains on `server-00` and is accessed with the explicit K3s kubeconfig.

## Pre-cleanup evidence

The target consisted of exactly three Docker Kind node containers:

```text
kind-platform-poc-2-control-plane
kind-platform-poc-2-worker
kind-platform-poc-2-worker2
```

Each had the Kind label `io.x-k8s.kind.cluster=kind-platform-poc-2` and used
`kindest/node:v1.35.0`. The old cluster reported three Ready nodes and its
resources were isolated from production K3s.

The target worker volumes were anonymous Docker volumes of approximately 20Gi,
1.4Gi and 13Gi. They were attached only to the target Kind containers. No
source files requiring preservation were found in `/home/admin/poc`, and
`/tmp/platform-poc-2.kube` was a zero-byte file.

The Docker `kind` network was shared by other Kind clusters and
`registry-proxy`; it was explicitly not a cleanup target.

## Cleanup performed

The exact command was:

```bash
kind delete cluster --name kind-platform-poc-2
```

The first attempt partially removed the control-plane and one worker. The
remaining exited worker was removed with the scoped command
`docker rm -f -v kind-platform-poc-2-worker`; a second exact Kind cleanup then
removed the remaining cluster metadata and kubeconfig context. The empty POC
file and empty `/home/admin/poc` directory were removed afterward.

No `docker system prune`, shared-network deletion, Registry deletion, K3s
command, production namespace operation or `/mnt/data` recursive deletion was
performed.

## Post-cleanup verification

- `kind get clusters` no longer lists `kind-platform-poc-2`;
- kubeconfig no longer lists `kind-kind-platform-poc-2`;
- no Docker container named `kind-platform-poc-2-*` remains;
- the shared `kind` network remains with other cluster/proxy endpoints;
- `registry-private`, `registry-proxy`, `liwei-dev`, `da-cluster`,
  `develop-cluster` and `test-cluster` containers remain;
- `/tmp/platform-poc-2.kube` and `/home/admin/poc` are absent;
- production K3s Pods remained Ready with their prior restart states.

## Recovery boundary

The old Kind runtime state and its anonymous volumes are intentionally not
recoverable after this cleanup. Production manifests, source files, version
locks and deployment records remain in the Material repository and production
K3s was not modified.
