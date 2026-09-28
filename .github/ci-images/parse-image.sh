#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dockerfile="$script_dir/Dockerfile"
github_output="${GITHUB_OUTPUT:-/dev/stdout}"

if [ ! -f "$dockerfile" ]; then
  echo "::error::Dockerfile not found at $dockerfile" >&2
  exit 1
fi

get_image() {
  local stage="$1"
  local matches
  matches="$(grep -iE "^FROM[[:space:]]+.+[[:space:]]+AS[[:space:]]+${stage}[[:space:]]*$" "$dockerfile" || true)"

  local count
  count="$(printf '%s\n' "$matches" | grep -c . || true)"

  if [ "$count" -eq 0 ]; then
    echo "::error::No FROM line found for stage '${stage}' in ${dockerfile}" >&2
    exit 1
  fi

  if [ "$count" -gt 1 ]; then
    echo "::error::Multiple FROM lines found for stage '${stage}' in ${dockerfile}" >&2
    exit 1
  fi

  local ref
  ref="$(awk '{ for (i = 1; i <= NF; i++) { if (tolower($i) == "as") { print $(i - 1); exit } } }' <<<"$matches")"

  if ! [[ "$ref" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]]; then
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
