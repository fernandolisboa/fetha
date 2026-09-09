#!/bin/sh
# Vercel "ignored build step" command.
#
# Exit 0 -> skip the build (docs-only change).
# Exit 1 -> proceed with the build.
#
# Vercel invokes this script for every deployment (VERCEL_GIT_PREVIOUS_SHA and
# VERCEL_GIT_COMMIT_SHA are set by the platform). Production deployments always
# build, regardless of which files changed.
set -eu

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "vercel-ignore-build: production deployment, building."
  exit 1
fi

if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] \
  && [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ] \
  && git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  range="${VERCEL_GIT_PREVIOUS_SHA}..${VERCEL_GIT_COMMIT_SHA}"
else
  range="HEAD^..HEAD"
fi

changed_files=$(git diff --name-only "$range" 2>/dev/null) || {
  echo "vercel-ignore-build: cannot compute diff for '$range', building."
  exit 1
}

if [ -z "$changed_files" ]; then
  echo "vercel-ignore-build: no changed files, building."
  exit 1
fi

old_ifs=$IFS
IFS='
'
for file in $changed_files; do
  case "$file" in
    *.md | docs/* | .claude/* | .github/* | LICENSE) ;;
    *)
      IFS=$old_ifs
      echo "vercel-ignore-build: '$file' is not docs-only, building."
      exit 1
      ;;
  esac
done
IFS=$old_ifs

echo "vercel-ignore-build: docs-only change, skipping build."
exit 0
