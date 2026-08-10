#!/usr/bin/env bash
set -euo pipefail

repo_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  pwd
)"
source_path="${repo_root}/environments/production/bootstrap"

read -r -a kubectl_command <<< "${KUBECTL_CMD:-kubectl}"

rendered_file="$(mktemp)"
trap 'rm -f "${rendered_file}"' EXIT

"${kubectl_command[@]}" kustomize "${source_path}" > "${rendered_file}"

kind_count="$(grep -c '^kind:' "${rendered_file}")"
if [ "${kind_count}" -ne 1 ]; then
  echo "expected exactly one rendered object, found ${kind_count}" >&2
  exit 1
fi

grep -qx 'kind: ConfigMap' "${rendered_file}"
grep -qx '  name: gitops-bootstrap-status' "${rendered_file}"
grep -qx '  namespace: model-platform-system' "${rendered_file}"

"${kubectl_command[@]}" apply \
  --dry-run=client \
  -f "${rendered_file}" \
  >/dev/null

echo "bootstrap_validation=PASS"
sha256sum "${rendered_file}"
