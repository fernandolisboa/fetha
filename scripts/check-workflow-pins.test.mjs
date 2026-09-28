import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkFile, checkRepo, run, validateUsesValue } from "./check-workflow-pins.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let workdir;

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
    workdir = undefined;
  }
});

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function writeWorkflow(content) {
  workdir = mkdtempSync(path.join(tmpdir(), "check-workflow-pins-"));
  const workflowsDir = path.join(workdir, ".github", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  const file = path.join(workflowsDir, "ci.yml");
  writeFileSync(file, content);
  return file;
}

describe("validateUsesValue", () => {
  it("accepts owner/repo pinned to a 40-hex sha", () => {
    assert.equal(validateUsesValue(`actions/checkout@${SHA}`), null);
  });

  it("accepts owner/repo/path pinned to a 40-hex sha (composite action subpath)", () => {
    assert.equal(validateUsesValue(`owner/repo/path/to/action@${SHA}`), null);
  });

  it("accepts a reusable workflow call pinned to a 40-hex sha", () => {
    assert.equal(validateUsesValue(`owner/repo/.github/workflows/x.yml@${SHA}`), null);
  });

  it("accepts a docker action pinned to a sha256 digest", () => {
    assert.equal(validateUsesValue("docker://alpine@sha256:" + "a".repeat(64)), null);
  });

  it("skips local actions referenced with a relative path", () => {
    assert.equal(validateUsesValue("./.github/actions/my-action"), null);
  });

  it("rejects a version tag", () => {
    assert.notEqual(validateUsesValue("actions/checkout@v4"), null);
  });

  it("rejects a branch name", () => {
    assert.notEqual(validateUsesValue("actions/checkout@main"), null);
  });

  it("rejects a short sha", () => {
    assert.notEqual(validateUsesValue("actions/checkout@3d3c42e"), null);
  });

  it("rejects a docker action pinned to a tag", () => {
    assert.notEqual(validateUsesValue("docker://alpine@latest"), null);
  });

  it("rejects an empty value (fails closed instead of skipping)", () => {
    assert.notEqual(validateUsesValue(""), null);
  });
});

describe("checkFile", () => {
  it("fails on a workflow pinned with @v4", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
`);
    const violations = checkFile(file);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].value, "actions/checkout@v4");
  });

  it("fails on a workflow pinned with @main", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@main
`);
    assert.equal(checkFile(file).length, 1);
  });

  it("fails on a workflow pinned with a short sha", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@3d3c42e
`);
    assert.equal(checkFile(file).length, 1);
  });

  it("passes on a workflow pinned to a full commit sha with a trailing tag comment", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA} # v7
`);
    assert.equal(checkFile(file).length, 0);
  });

  it("ignores local actions", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: ./.github/actions/my-action
`);
    assert.equal(checkFile(file).length, 0);
  });

  it("fails closed on a uses: line with an empty value", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses:
          actions/checkout@${SHA}
`);
    const violations = checkFile(file);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].value, "");
  });

  it("fails closed on a uses line with a space before the colon", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses : actions/checkout@v4
`);
    const violations = checkFile(file);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].value, "actions/checkout@v4");
  });
});

describe("checkRepo", () => {
  it("passes on the current repository workflows", () => {
    assert.deepEqual(checkRepo(REPO_ROOT), []);
  });

  it("also checks uses: in composite actions under .github/actions", () => {
    workdir = mkdtempSync(path.join(tmpdir(), "check-workflow-pins-"));
    const actionsDir = path.join(workdir, ".github", "actions", "my-action");
    mkdirSync(actionsDir, { recursive: true });
    writeFileSync(
      path.join(actionsDir, "action.yml"),
      `
runs:
  using: composite
  steps:
    - uses: actions/checkout@v4
      shell: bash
`,
    );
    const violations = checkRepo(workdir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].value, "actions/checkout@v4");
  });
});

describe("run", () => {
  it("reports ok with a file count on the current repository workflows", () => {
    const result = run(REPO_ROOT);
    assert.equal(result.ok, true);
    assert.equal(result.noFilesFound, false);
    assert.equal(result.violations.length, 0);
    assert.ok(result.fileCount > 0);
  });

  it("fails closed instead of reporting ok when no workflow files exist", () => {
    workdir = mkdtempSync(path.join(tmpdir(), "check-workflow-pins-"));
    const result = run(workdir);
    assert.equal(result.ok, false);
    assert.equal(result.noFilesFound, true);
    assert.equal(result.fileCount, 0);
  });
});
