#!/bin/sh
# ADR-0013 says packages/engine/src/api.ts is verbatim inside its frozen fenced block: "Code
# and this ADR must match; when they disagree, the code is a bug (or this ADR has been
# superseded)." An additive change to api.ts (a new NoteCode or EngineErrorCode member) must
# land in both files byte-identically. This lives outside packages/engine because the engine
# has zero I/O (no fs/path imports), so the check cannot be a vitest test inside the package.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
adr="$script_dir/docs/adr/0013-engine-public-interface.md"
api="$script_dir/packages/engine/src/api.ts"

extracted=$(awk '
  /The following is `packages\/engine\/src\/api\.ts` verbatim\./ { found=1 }
  found && /^```ts$/ && !in_block { in_block=1; next }
  in_block && /^```$/ { exit }
  in_block { print }
' "$adr")

actual=$(cat "$api")

if [ "$extracted" = "$actual" ]; then
  echo "ok - ADR-0013 frozen block matches packages/engine/src/api.ts"
else
  echo "not ok - ADR-0013 frozen block differs from packages/engine/src/api.ts"
  workdir=$(mktemp -d)
  trap 'rm -rf "$workdir"' EXIT
  printf '%s\n' "$extracted" >"$workdir/expected"
  printf '%s\n' "$actual" >"$workdir/actual"
  diff "$workdir/expected" "$workdir/actual" || true
  exit 1
fi
