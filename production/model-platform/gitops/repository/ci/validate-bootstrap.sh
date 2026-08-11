#!/bin/sh
set -eu

repo_root="$(
  CDPATH= cd -- "$(dirname -- "$0")/.."
  pwd -P
)"
source_path="${repo_root}/environments/production/bootstrap"

run_kubectl() {
  case "${KUBECTL_CMD:-kubectl}" in
    kubectl)
      kubectl "$@"
      ;;
    'sudo k3s kubectl')
      sudo k3s kubectl "$@"
      ;;
    *)
      echo "unsupported KUBECTL_CMD: ${KUBECTL_CMD}" >&2
      return 2
      ;;
  esac
}

rendered_file="$(mktemp)"
trap 'rm -f "${rendered_file}"' EXIT

run_kubectl kustomize "${source_path}" > "${rendered_file}"

kind_count="$(grep -c '^kind:' "${rendered_file}")"
if [ "${kind_count}" -ne 1 ]; then
  echo "expected exactly one rendered object, found ${kind_count}" >&2
  exit 1
fi

grep -qx 'kind: ConfigMap' "${rendered_file}"
grep -qx '  name: gitops-bootstrap-status' "${rendered_file}"
grep -qx '  namespace: model-platform-system' "${rendered_file}"

echo "bootstrap_validation=PASS"
sha256sum "${rendered_file}"
