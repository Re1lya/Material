# Backstage mock scheduling form release record

Date: 2026-08-14  
Scope: Backstage application image only; no model runtime activation.

## Build and publish

- A minimal source archive was copied to `server-00` after local exclusion of
  `node_modules`, Yarn caches, generated frontend output and TypeScript build
  state.
- Archive SHA-256:
  `b030fca6bcddc79001e88e192538c9425a390696dbdfadb416f4147a1ae5075c`.
- The image was built with Docker `--platform linux/amd64` from
  `packages/backend/Dockerfile`.
- Target:
  `110.120.0.3:30670/container-images/model-platform-backstage:v0.2.9`.
- Immutable digest:
  `sha256:fee9830d4ba7f99234033bbfde10c1a5e51edda908c734de70f30015ca92a934`.
- Docker reported `linux/amd64`; the push changed only Artifact Keeper image
  storage.

## Release boundary

The digest is locked in `kubernetes/backstage.yaml` and `versions.lock.yaml`.
A repository-scoped read-only Secret named `artifact-keeper-backstage-pull`
was installed in the production `backstage` namespace through an interactive,
out-of-band credential flow. A server-side dry-run and apply of only
`kubernetes/backstage.yaml` completed, and the single Backstage Deployment
returned `1/1 Ready` with the new digest. Do not apply any model-serving, Ray,
Crossplane or NPU resource as part of this release.

During the first attempt, the admin user's POC kubeconfig was detected after a
short-lived Pending Backstage Pod appeared in `kind-kind-platform-poc-2`. That
POC Deployment was immediately rolled back to its prior `0.1.9` ReplicaSet,
returned `1/1 Running`, and the accidentally copied pull Secret was removed
from the POC namespace. Production was then updated using the root K3s
kubeconfig.

## Safety evidence

- No Crossplane XR, generated model Deployment, Ray workload, NPU resource,
  Artifact Keeper data PV, Gitea workload or other namespace was modified.
- The effective mock model profile remains Qwen TP=6, replicas=0, NPU=0.
- Local TypeScript compilation, frontend test, YAML/JSON parsing, schema
  validation and `git diff --check` passed before the image build.
