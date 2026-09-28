#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dockerfile="${CI_IMAGES_DOCKERFILE:-$script_dir/Dockerfile}"
github_output="${GITHUB_OUTPUT:-/dev/stdout}"

if [ ! -f "$dockerfile" ]; then
  echo "::error::Dockerfile not found at $dockerfile" >&2
  exit 1
fi

get_image() {
  local stage="$1"
  local line
  line="$(grep -iE "^FROM[[:space:]]+.+[[:space:]]+AS[[:space:]]+${stage}[[:space:]]*$" "$dockerfile" || true)"

  if [ -z "$line" ]; then
    echo "::error::No FROM line found for stage '${stage}' in ${dockerfile}" >&2
    exit 1
  fi

  local ref
  ref="$(awk '{print $2}' <<<"$line")"

  if ! [[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::Stage '${stage}' image ref '${ref}' is not digest-pinned (expected @sha256:<64 hex>)" >&2
    exit 1
  fi

  echo "$ref"
}

postgres_ref="$(get_image postgres)"
neon_proxy_ref="$(get_image neon-proxy)"

{
  echo "postgres=${postgres_ref}"
  echo "neon-proxy=${neon_proxy_ref}"
} >>"$github_output"
