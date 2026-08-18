# CPU-only ModelScope importer

`modelscope_import.py` is the first-stage importer for the Qwen3.8 release
unit. It has no Kubernetes client and no NPU dependency. A caller supplies a
ModelScope commit revision, a publisher token file, and an Artifact Keeper
publisher token file. The importer then:

1. downloads the exact ModelScope snapshot to a unique local staging directory;
2. excludes SDK state directories, rejects symlinks/path traversal, and hashes
   every regular file;
3. publishes to `model-artifacts/<prefix>` using the installed Artifact Keeper
   `PUT /api/v1/repositories/<repo>/artifacts/<path>` API;
4. reads every existing/uploaded file back before accepting it; and
5. uploads `manifest.json` last as the release marker. A second run with the
   same bytes is a no-op; a different byte stream fails instead of overwriting
   a formal artifact.

The script never prints token contents. `MODELSCOPE_API_TOKEN` is populated
only in the importer process, and the runtime/cache path receives a separate
Artifact Keeper read-only credential.

## Build and release gate

The Dockerfile requires `BASE_IMAGE` explicitly. Build an ARM64/AMD64 CPU
image on an authorized build host from a reviewed Python base digest, publish
it to `110.120.0.3:30670/container-images`, and record the resulting manifest
digest before creating an importer Job. The repository intentionally does not
contain a production image digest or a Kubernetes Job with a placeholder.

The requirements lock currently pins `modelscope==1.38.1`; the build must
record the resolved wheel hashes in the release evidence and use the internal
package mirror approved for the build host.

## Required runtime inputs

```text
MODELSCOPE_MODEL_ID=Qwen/Qwen3.8-27B-FP8
MODELSCOPE_REVISION=<lowercase ModelScope commit id>
MODELSCOPE_TOKEN_FILE=/var/run/secrets/modelscope/token   # optional for public repos, still a file
AK_BASE_URL=http://artifact-keeper-backend.artifact-keeper.svc.cluster.local:8080
AK_REPOSITORY=model-artifacts
AK_ARTIFACT_PREFIX=qwen3.8-27b/<revision>
AK_PUBLISHER_TOKEN_FILE=/var/run/secrets/artifact-keeper/publisher-token
STAGING_ROOT=/var/lib/model-import
```

The intended CPU Job is scheduled on an explicitly approved non-NPU node and
uses a temporary staging PVC or external staging directory. It must not use
`gpu-server-00` until disk/network capacity, ModelScope availability, and the
Artifact Keeper publisher credential have been separately approved. No Job is
installed by this change.

Run the local unit test without the SDK or network:

```bash
python3 -m unittest discover -s production/model-platform/importer -p 'test_*.py'
```
