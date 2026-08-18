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
