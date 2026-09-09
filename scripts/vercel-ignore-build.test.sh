#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script="$script_dir/vercel-ignore-build.sh"
workdir=$(mktemp -d)
origin="$workdir/origin.git"
repo="$workdir/repo"
out="$workdir/out.log"
failures=0

cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

git init -q --bare "$origin"
git init -q -b main "$repo"
git -C "$repo" config user.email "test@fetha.local"
git -C "$repo" config user.name "Fetha Test"
git -C "$repo" remote add origin "$origin"

mkdir -p "$repo/docs/adr" "$repo/apps/web/src/app"
echo "# Fetha" >"$repo/README.md"
echo "console.log('app')" >"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "chore: initial commit"
git -C "$repo" push -q origin main

assert_exit() {
  description=$1
  expected=$2
  shift 2
  set +e
  (cd "$repo" && "$@" "$script" >"$out" 2>&1)
  actual=$?
  set -e
  if [ "$actual" -eq "$expected" ]; then
    echo "ok - $description"
  else
    echo "not ok - $description (expected exit $expected, got $actual)"
    cat "$out"
    failures=$((failures + 1))
  fi
}

echo "docs change" >"$repo/docs/adr/0016-example.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: add ADR"
assert_exit "docs-only commit skips the build" 0 env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" push -q origin main

echo "export const x = 1;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: touch page"
assert_exit "code-only commit builds" 1 env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" push -q origin main

echo "more docs" >>"$repo/README.md"
echo "export const y = 2;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: mixed docs and code"
assert_exit "mixed commit builds" 1 env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" push -q origin main

echo "docs only again" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: touch readme"
assert_exit "production env always builds" 1 \
  env -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA VERCEL_ENV=production sh
git -C "$repo" push -q origin main

echo "docs sha range" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: touch readme again"
base_sha=$(git -C "$repo" rev-parse HEAD~1)
head_sha=$(git -C "$repo" rev-parse HEAD)
assert_exit "explicit VERCEL_GIT_* shas, docs-only, skip" 0 \
  env -u VERCEL_ENV VERCEL_GIT_PREVIOUS_SHA="$base_sha" VERCEL_GIT_COMMIT_SHA="$head_sha" sh
git -C "$repo" push -q origin main

git -C "$repo" remote remove origin
assert_exit "unknown base builds" 1 \
  env -u VERCEL_ENV \
  VERCEL_GIT_PREVIOUS_SHA="0000000000000000000000000000000000000000" \
  VERCEL_GIT_COMMIT_SHA="$(git -C "$repo" rev-parse HEAD)" sh
git -C "$repo" remote add origin "$origin"

git -C "$repo" checkout -q -b feature-a
echo "export const z = 1;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: add code"
echo "regression docs" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: regression tip"
assert_exit "code then docs commit builds via merge-base with origin/main" 1 \
  env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" checkout -q main

git -C "$repo" checkout -q -b feature-b
echo "export const w = 1;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: another code change"
git -C "$repo" checkout -q -b merge-target main
git -C "$repo" merge -q --no-ff -m "merge: bring in feature-b" feature-b
assert_exit "merge commit at tip that merged code builds" 1 \
  env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" checkout -q main

current_sha=$(git -C "$repo" rev-parse HEAD)
assert_exit "empty diff (redeploy of the same SHA) builds" 1 \
  env -u VERCEL_ENV VERCEL_GIT_PREVIOUS_SHA="$current_sha" VERCEL_GIT_COMMIT_SHA="$current_sha" sh

git -C "$repo" checkout -q -b docs-under-apps
echo "# notes" >"$repo/apps/web/NOTES.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: notes under apps"
assert_exit "markdown file under apps/ is not docs-only, builds" 1 \
  env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" checkout -q main

if [ "$failures" -ne 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi

echo "all vercel-ignore-build tests passed"
