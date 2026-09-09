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

assert_exit_in_subdir() {
  description=$1
  expected=$2
  subdir=$3
  shift 3
  set +e
  (cd "$repo/$subdir" && "$@" "$script" >"$out" 2>&1)
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

echo "docs from subdirectory" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: touch readme from apps/web cwd"
assert_exit_in_subdir "invoked from apps/web subdirectory, docs-only, skip" 0 "apps/web" \
  env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" push -q origin main

echo "export const v = 1;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: touch page from apps/web cwd"
assert_exit_in_subdir "invoked from apps/web subdirectory, code change, builds" 1 "apps/web" \
  env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" push -q origin main

i=1
while [ "$i" -le 6 ]; do
  echo "filler $i" >>"$repo/README.md"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore: filler commit $i to pad history past clone depth"
  i=$((i + 1))
done
git -C "$repo" push -q origin main

git -C "$repo" checkout -q -b shallow-docs-only main
echo "shallow docs only" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: shallow single-branch docs only"
git -C "$repo" push -q origin shallow-docs-only

shallow_repo="$workdir/shallow-docs-only"
git clone -q --depth=10 --single-branch --branch shallow-docs-only "file://$origin" "$shallow_repo"
git -C "$shallow_repo" config user.email "test@fetha.local"
git -C "$shallow_repo" config user.name "Fetha Test"
if [ "$(git -C "$shallow_repo" rev-parse --is-shallow-repository)" != "true" ]; then
  echo "not ok - precondition: shallow-docs-only clone is shallow"
  failures=$((failures + 1))
fi
set +e
(cd "$shallow_repo" && env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh "$script" >"$out" 2>&1)
actual=$?
set -e
if [ "$actual" -eq 0 ]; then
  echo "ok - shallow single-branch clone, docs-only range, skips"
else
  echo "not ok - shallow single-branch clone, docs-only range, skips (expected exit 0, got $actual)"
  cat "$out"
  failures=$((failures + 1))
fi

git -C "$repo" checkout -q -b shallow-code-then-docs main
echo "export const shallow = 1;" >>"$repo/apps/web/src/app/page.tsx"
git -C "$repo" add -A
git -C "$repo" commit -q -m "feat: shallow code change"
echo "shallow code then docs" >>"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: shallow docs after code"
git -C "$repo" push -q origin shallow-code-then-docs

shallow_repo_2="$workdir/shallow-code-then-docs"
git clone -q --depth=10 --single-branch --branch shallow-code-then-docs "file://$origin" "$shallow_repo_2"
git -C "$shallow_repo_2" config user.email "test@fetha.local"
git -C "$shallow_repo_2" config user.name "Fetha Test"
if [ "$(git -C "$shallow_repo_2" rev-parse --is-shallow-repository)" != "true" ]; then
  echo "not ok - precondition: shallow-code-then-docs clone is shallow"
  failures=$((failures + 1))
fi
set +e
(cd "$shallow_repo_2" && env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh "$script" >"$out" 2>&1)
actual=$?
set -e
if [ "$actual" -eq 1 ]; then
  echo "ok - shallow single-branch clone, code-then-docs range, builds"
else
  echo "not ok - shallow single-branch clone, code-then-docs range, builds (expected exit 1, got $actual)"
  cat "$out"
  failures=$((failures + 1))
fi

git -C "$repo" checkout -q main

full_clone="$workdir/full-clone"
git clone -q "$origin" "$full_clone"
git -C "$full_clone" config user.email "test@fetha.local"
git -C "$full_clone" config user.name "Fetha Test"
before_shallow=$(git -C "$full_clone" rev-parse --is-shallow-repository)
set +e
(cd "$full_clone" && env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh "$script" >"$out" 2>&1)
set -e
after_shallow=$(git -C "$full_clone" rev-parse --is-shallow-repository)
if [ "$before_shallow" = "false" ] && [ "$after_shallow" = "false" ]; then
  echo "ok - full clone stays non-shallow after run"
else
  echo "not ok - full clone stays non-shallow after run (before=$before_shallow after=$after_shallow)"
  cat "$out"
  failures=$((failures + 1))
fi

git -C "$repo" checkout -q -b non-ascii-docs
echo "reuniao" >"$repo/docs/notas de reunião.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m "docs: add non-ascii filename"
assert_exit "non-ascii filename under docs/ is docs-only, skips" 0 \
  env -u VERCEL_ENV -u VERCEL_GIT_PREVIOUS_SHA -u VERCEL_GIT_COMMIT_SHA sh
git -C "$repo" checkout -q main
git -C "$repo" push -q origin non-ascii-docs

if [ "$failures" -ne 0 ]; then
  echo "$failures test(s) failed"
  exit 1
fi

echo "all vercel-ignore-build tests passed"
