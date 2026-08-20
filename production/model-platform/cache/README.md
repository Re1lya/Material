# Artifact Keeper node-cache image

`model-cache-fetch.py` is reused by the Crossplane Composition's zero-NPU
cache Job.  The Dockerfile builds a small CPU-only image; it does not contain
ModelScope, a model, or Ascend libraries. The Job reads only the
repository-scoped Artifact Keeper runtime Secret and writes to the dedicated
node-local PVC.

Build and mirror the image to
`110.120.0.3:30670/container-images/model-cache`, then replace the release
contract image with the immutable digest. Until that gate passes, the
Composition is not installed. Do not point it at `ora-desktop-cache-local` or
at an existing hostPath.

`a3-local-pv.yaml` is the cluster-admin-owned cache substrate for the first
Qwen3.8 release. It creates one `Retain` local PV pinned to `a3-server-00` and
the reusable `model-cache-gpu-local` no-provisioner StorageClass. Crossplane
creates only the namespaced PVC; it does not receive PV, StorageClass or Node
permissions. The host directory must be created explicitly with UID/GID 65532
before applying the manifest. Deleting the XR or PVC therefore cannot delete
the downloaded model files.
