import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkFile, checkRepo, validateUsesValue } from "./check-workflow-pins.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

let workdir;

afterEach(() => {
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
    expect(validateUsesValue(`actions/checkout@${SHA}`)).toBeNull();
  });

  it("accepts owner/repo/path pinned to a 40-hex sha (composite action subpath)", () => {
    expect(validateUsesValue(`owner/repo/path/to/action@${SHA}`)).toBeNull();
  });

  it("accepts a reusable workflow call pinned to a 40-hex sha", () => {
    expect(validateUsesValue(`owner/repo/.github/workflows/x.yml@${SHA}`)).toBeNull();
  });

  it("accepts a docker action pinned to a sha256 digest", () => {
    expect(validateUsesValue("docker://alpine@sha256:" + "a".repeat(64))).toBeNull();
  });

  it("skips local actions referenced with a relative path", () => {
    expect(validateUsesValue("./.github/actions/my-action")).toBeNull();
  });

  it("rejects a version tag", () => {
    expect(validateUsesValue("actions/checkout@v4")).not.toBeNull();
  });

  it("rejects a branch name", () => {
    expect(validateUsesValue("actions/checkout@main")).not.toBeNull();
  });

  it("rejects a short sha", () => {
    expect(validateUsesValue("actions/checkout@3d3c42e")).not.toBeNull();
  });

  it("rejects a docker action pinned to a tag", () => {
    expect(validateUsesValue("docker://alpine@latest")).not.toBeNull();
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
    expect(violations).toHaveLength(1);
    expect(violations[0].value).toBe("actions/checkout@v4");
  });

  it("fails on a workflow pinned with @main", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@main
`);
    expect(checkFile(file)).toHaveLength(1);
  });

  it("fails on a workflow pinned with a short sha", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@3d3c42e
`);
    expect(checkFile(file)).toHaveLength(1);
  });

  it("passes on a workflow pinned to a full commit sha with a trailing tag comment", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA} # v7
`);
    expect(checkFile(file)).toHaveLength(0);
  });

  it("ignores local actions", () => {
    const file = writeWorkflow(`
jobs:
  build:
    steps:
      - uses: ./.github/actions/my-action
`);
    expect(checkFile(file)).toHaveLength(0);
  });
});

describe("checkRepo", () => {
  it("passes on the current repository workflows", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    expect(checkRepo(repoRoot)).toEqual([]);
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
    expect(violations).toHaveLength(1);
    expect(violations[0].value).toBe("actions/checkout@v4");
  });
});
