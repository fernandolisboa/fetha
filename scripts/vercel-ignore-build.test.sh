#!/bin/sh
# Bash test for scripts/vercel-ignore-build.sh, run via a temporary git repo.
# Wired into `pnpm test` from the root package.json.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script="$script_dir/vercel-ignore-build.sh"
repo=$(mktemp -d)
failures=0

cleanup() {
  rm -rf "$repo"
}
trap cleanup EXIT

git init -q "$repo"
git -C "$repo" config user.email "test@fetha.local"
git -C "$repo" config user.name "Fetha Test"

mkdir -p "$repo/docs/adr" "$repo/apps/web/src/app"
echo "# Fetha" >"$repo/README.md"
echo "console.log('app')" >"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "chore: initial commit"

assert_exit() {
  description=$1
  expected=$2
  shift 2
  set +e
  (cd "$repo" && "$@" "$script" >/tmp/vercel-ignore-build.out 2>&1)
  actual=$?
  set -e
  if [ "$actual" -eq "$expected" ]; then
    echo "ok - $description"
  else
    echo "not ok - $description (expected exit $expected, got $actual)"
    cat /tmp/vercel-ignore-build.out
    failures=$((failures + 1))
  fi
}

echo "docs change" >"$repo/docs/adr/0016-example.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: add ADR"
assert_exit "docs-only commit skips the build" 0 env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh

echo "export const x = 1;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: touch page"
assert_exit "code-only commit builds" 1 env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh

echo "more docs" >>"$repo/README.md"
echo "export const y = 2;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: mixed docs and code"
assert_exit "mixed commit builds" 1 env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh

echo "docs only again" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: touch readme"
assert_exit "production env always builds" 1 env -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA VERCEL_ENV=production sh

base_sha=$(git -C "$repo" rev-parse HEAD~1)
head_sha=$(git -C "$repo" rev-parse HEAD)
assert_exit "explicit VERCEL_GIT_* shas, docs-only, skip" 0 \
  env -u VERCEL_ENV VERCEL_GIT_PREVIOUS_SHA="$base_sha" VERCEL_GIT_COMMIT_SHA="$head_sha" sh

assert_exit "unknown previous sha falls back to HEAD^..HEAD" 0 \
  env -u VERCEL_ENV VERCEL_GIT_PREVIOUS_SHA="0000000000000000000000000000000000000000" VERCEL_GIT_COMMIT_SHA="$head_sha" sh

if [ "$failures" -ne 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi

echo "all vercel-ignore-build tests passed"
