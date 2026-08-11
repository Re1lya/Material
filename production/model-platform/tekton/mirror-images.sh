#!/bin/sh
set -eu

lock_file="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/images.lock"
regctl_bin="${REGCTL_BIN:-regctl}"
docker_bin="${DOCKER_BIN:-docker}"
ghcr_proxy_host="${GHCR_PROXY_HOST:-}"
mirror_jobs="${MIRROR_JOBS:-1}"

case "${mirror_jobs}" in
  ''|*[!0-9]*|0)
    echo "MIRROR_JOBS must be a positive integer" >&2
    exit 1
    ;;
esac

"${regctl_bin}" registry set 110.120.0.3:8889 --tls disabled >/dev/null

mirror_one() {
  source="$1"
  target="$2"
  platform_digest="$3"
  source_digest="${source##*@}"
  copy_source="${source}"
  case "${source}" in
    ghcr.io/*)
      if [ -n "${ghcr_proxy_host}" ]; then
        copy_source="${ghcr_proxy_host}/${source#ghcr.io/}"
      fi
      ;;
  esac

  transport_digest="$("${regctl_bin}" manifest digest "${copy_source}")"
  if [ "${source_digest}" != "${transport_digest}" ]; then
    echo "source digest mismatch through transport ${copy_source}: ${transport_digest}" >&2
    exit 1
  fi

  transport_platform_digest="$(
    "${regctl_bin}" image digest "${copy_source}" --platform linux/amd64
  )"
  if [ "${platform_digest}" != "${transport_platform_digest}" ]; then
    echo "linux/amd64 digest mismatch through transport ${copy_source}: ${transport_platform_digest}" >&2
    exit 1
  fi

  current_target_digest="$("${regctl_bin}" image digest "${target}" 2>/dev/null || true)"
  if [ "${platform_digest}" = "${current_target_digest}" ]; then
    echo "verified existing ${target}@${current_target_digest}"
    return
  fi

  echo "pull ${copy_source} -> ${target}"
  "${docker_bin}" pull "${copy_source}"
  local_platform="$(${docker_bin} image inspect "${copy_source}" --format '{{.Os}}/{{.Architecture}}')"
  if [ "${local_platform}" != "linux/amd64" ]; then
    echo "unexpected local platform for ${copy_source}: ${local_platform}" >&2
    exit 1
  fi
  "${docker_bin}" tag "${copy_source}" "${target}"
  "${docker_bin}" push "${target}"

  target_digest="$("${regctl_bin}" image digest "${target}")"
  if [ "${platform_digest}" != "${target_digest}" ]; then
    echo "digest mismatch for ${target}: ${target_digest}" >&2
    exit 1
  fi
  echo "verified ${target}@${target_digest}"
}

running=0
pids=""
batch_failed=0

while IFS='|' read -r source target platform_digest; do
  case "${source}" in
    ''|'#'*) continue ;;
  esac

  mirror_one "${source}" "${target}" "${platform_digest}" &
  pids="${pids} $!"
  running=$((running + 1))

  if [ "${running}" -ge "${mirror_jobs}" ]; then
    for pid in ${pids}; do
      if ! wait "${pid}"; then
        batch_failed=1
      fi
    done
    if [ "${batch_failed}" -ne 0 ]; then
      exit 1
    fi
    running=0
    pids=""
  fi
done < "${lock_file}"

for pid in ${pids}; do
  if ! wait "${pid}"; then
    batch_failed=1
  fi
done
if [ "${batch_failed}" -ne 0 ]; then
  exit 1
fi

echo 'tekton_image_mirror=PASS'
