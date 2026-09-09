#!/bin/sh
# Exit 0 -> skip the build (docs-only change). Exit 1 -> proceed with the build.
# Vercel's ignoreCommand contract: it inspects the exit code, not stdout, and
# always builds production regardless of which files changed.
set -eu

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "vercel-ignore-build: production deployment, building."
  exit 1
fi

range=""

if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] \
  && [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ] \
  && git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  range="${VERCEL_GIT_PREVIOUS_SHA}..${VERCEL_GIT_COMMIT_SHA}"
else
  if git fetch --depth=50 origin main 2>/dev/null; then
    merge_base=$(git merge-base origin/main HEAD 2>/dev/null) || merge_base=""
    if [ -n "$merge_base" ]; then
      range="${merge_base}...HEAD"
    fi
  fi
fi

if [ -z "$range" ]; then
  echo "vercel-ignore-build: cannot establish a reliable base, building."
  exit 1
fi

changed_files=$(git diff --name-only --no-renames "$range" 2>/dev/null) || {
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
    docs/* | .claude/* | .github/* | LICENSE) ;;
    *.md)
      case "$file" in
        */*)
          IFS=$old_ifs
          echo "vercel-ignore-build: '$file' is not docs-only, building."
          exit 1
          ;;
      esac
      ;;
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
