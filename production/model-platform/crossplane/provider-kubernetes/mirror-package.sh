#!/bin/sh
# Mirror one Crossplane package through an explicitly selected transport.
#
# The transport may be a dockerproxy/pull-through registry, but it is never a
# production dependency.  The package is verified against the upstream index
# and linux/amd64 digests before it is copied to Artifact Keeper.  Crossplane
# must later consume the internal Artifact Keeper reference from the reviewed
# package manifest.
set -eu

regctl_bin="${REGCTL_BIN:-regctl}"
source_ref="${SOURCE_PACKAGE_REF:-xpkg.crossplane.io/crossplane-contrib/provider-kubernetes:v1.0.0@sha256:fd54bbc7f87744eaef61cd52647fe6f641d9d5c323619de5527bfb8e1ab7a6ea}"
transport_ref="${TRANSPORT_PACKAGE_REF:-${source_ref}}"
target_ref="${TARGET_PACKAGE_REF:-110.120.0.3:30670/container-images/provider-kubernetes:v1.0.0}"
expected_index_digest="${EXPECTED_INDEX_DIGEST:-sha256:fd54bbc7f87744eaef61cd52647fe6f641d9d5c323619de5527bfb8e1ab7a6ea}"
expected_amd64_digest="${EXPECTED_AMD64_DIGEST:-sha256:e0198c31a99eedcfc061c008da56fbffff967f54b211475cd19185408ed2e61d}"
expected_arm64_digest="${EXPECTED_ARM64_DIGEST:-sha256:3f9ee3d6fb05f7f92b845c921e235cb62a1dab5905bf19052580144e7b4e8df0}"
regctl_req_concurrent="${REGCTL_REQ_CONCURRENT:-1}"
regctl_blob_max="${REGCTL_BLOB_MAX:--1}"
target_registry="${target_ref%%/*}"

if ! command -v "${regctl_bin}" >/dev/null 2>&1; then
  echo "regctl is required; install the pinned CI tool before mirroring" >&2
  exit 1
fi

# The current Artifact Keeper NodePort is an internal HTTP endpoint.  The
# registry's writer credential must already be configured in regctl's local
# credential store; this script never reads Kubernetes Secrets or prints auth.
"${regctl_bin}" registry set "${target_registry}" --tls disabled \
  --req-concurrent "${regctl_req_concurrent}" --blob-max "${regctl_blob_max}" >/dev/null

transport_index_digest="$("${regctl_bin}" manifest digest "${transport_ref}")"
if [ "${transport_index_digest}" != "${expected_index_digest}" ]; then
  echo "transport index digest mismatch: ${transport_index_digest}" >&2
  exit 1
fi

transport_amd64_digest="$("${regctl_bin}" image digest "${transport_ref}" --platform linux/amd64)"
if [ "${transport_amd64_digest}" != "${expected_amd64_digest}" ]; then
  echo "transport linux/amd64 digest mismatch: ${transport_amd64_digest}" >&2
  exit 1
fi
transport_arm64_digest="$("${regctl_bin}" image digest "${transport_ref}" --platform linux/arm64)"
if [ "${transport_arm64_digest}" != "${expected_arm64_digest}" ]; then
  echo "transport linux/arm64 digest mismatch: ${transport_arm64_digest}" >&2
  exit 1
fi

echo "copy ${transport_ref} -> ${target_ref}"
"${regctl_bin}" image copy "${transport_ref}" "${target_ref}"

target_index_digest="$("${regctl_bin}" manifest digest "${target_ref}")"
target_amd64_digest="$("${regctl_bin}" image digest "${target_ref}" --platform linux/amd64)"
target_arm64_digest="$("${regctl_bin}" image digest "${target_ref}" --platform linux/arm64)"
if [ "${target_index_digest}" != "${expected_index_digest}" ]; then
  echo "target index digest mismatch: ${target_index_digest}" >&2
  exit 1
fi
if [ "${target_amd64_digest}" != "${expected_amd64_digest}" ]; then
  echo "target linux/amd64 digest mismatch: ${target_amd64_digest}" >&2
  exit 1
fi
if [ "${target_arm64_digest}" != "${expected_arm64_digest}" ]; then
  echo "target linux/arm64 digest mismatch: ${target_arm64_digest}" >&2
  exit 1
fi

echo "provider_package_mirror=PASS"
echo "artifact_keeper_tag=${target_ref}"
echo "artifact_keeper_index_digest=${target_index_digest}"
echo "artifact_keeper_linux_amd64_digest=${target_amd64_digest}"
echo "artifact_keeper_linux_arm64_digest=${target_arm64_digest}"
