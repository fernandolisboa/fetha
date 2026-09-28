import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyStatuses,
  selectPreviewDeployment,
  waitForPreview,
} from "./wait-for-vercel-preview.mjs";

const VERCEL_BOT = { login: "vercel[bot]" };

describe("selectPreviewDeployment", () => {
  it("picks the deployment created by vercel[bot] with environment Preview", () => {
    const deployments = [
      { id: 1, environment: "Preview", creator: VERCEL_BOT, created_at: "2026-09-28T00:00:00Z" },
    ];
    assert.equal(selectPreviewDeployment(deployments)?.id, 1);
  });

  it("ignores deployments from other environments", () => {
    const deployments = [
      {
        id: 1,
        environment: "Production",
        creator: VERCEL_BOT,
        created_at: "2026-09-28T00:00:00Z",
      },
    ];
    assert.equal(selectPreviewDeployment(deployments), null);
  });

  it("ignores deployments not created by vercel[bot]", () => {
    const deployments = [
      {
        id: 1,
        environment: "Preview",
        creator: { login: "someone-else" },
        created_at: "2026-09-28T00:00:00Z",
      },
    ];
    assert.equal(selectPreviewDeployment(deployments), null);
  });

  it("returns null on an empty list", () => {
    assert.equal(selectPreviewDeployment([]), null);
  });

  it("picks the most recently created candidate when several exist (redeploy)", () => {
    const deployments = [
      { id: 1, environment: "Preview", creator: VERCEL_BOT, created_at: "2026-09-28T00:00:00Z" },
      { id: 2, environment: "Preview", creator: VERCEL_BOT, created_at: "2026-09-28T01:00:00Z" },
    ];
    assert.equal(selectPreviewDeployment(deployments)?.id, 2);
  });
});

describe("classifyStatuses", () => {
  it("reports pending on an empty statuses list", () => {
    assert.deepEqual(classifyStatuses([]), { status: "pending" });
  });

  it("reports success with the environment_url from the newest status", () => {
    const statuses = [
      { state: "success", environment_url: "https://fetha-xxxx-feuxs-projects.vercel.app" },
      { state: "queued" },
    ];
    assert.deepEqual(classifyStatuses(statuses), {
      status: "success",
      url: "https://fetha-xxxx-feuxs-projects.vercel.app",
    });
  });

  it("treats a success status missing environment_url as a failure", () => {
    const result = classifyStatuses([{ state: "success" }]);
    assert.equal(result.status, "failure");
  });

  it("reports failure on a failure state", () => {
    const result = classifyStatuses([{ state: "failure" }]);
    assert.equal(result.status, "failure");
  });

  it("reports failure on an error state", () => {
    const result = classifyStatuses([{ state: "error" }]);
    assert.equal(result.status, "failure");
  });

  it("reports pending on an in-progress state", () => {
    assert.deepEqual(classifyStatuses([{ state: "queued" }]), { status: "pending" });
  });

  it("only looks at the newest (first) status entry", () => {
    const statuses = [{ state: "queued" }, { state: "success", environment_url: "https://x" }];
    assert.deepEqual(classifyStatuses(statuses), { status: "pending" });
  });
});

describe("waitForPreview", () => {
  it("returns the url as soon as poll reports success", async () => {
    const url = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      token: "token",
      poll: async () => ({ status: "success", url: "https://preview.example.com" }),
      sleep: async () => {
        throw new Error("should not sleep when the first poll succeeds");
      },
    });
    assert.equal(url, "https://preview.example.com");
  });

  it("throws when poll reports failure", async () => {
    await assert.rejects(
      waitForPreview({
        repo: "fernandolisboa/fetha",
        sha: "abc123",
        token: "token",
        poll: async () => ({ status: "failure", reason: "deployment status is error" }),
      }),
      /deployment status is error/,
    );
  });

  it("polls again on pending, then resolves on success", async () => {
    let calls = 0;
    const url = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      token: "token",
      now: () => 0,
      timeoutMs: 60_000,
      sleep: async () => {},
      poll: async () => {
        calls += 1;
        if (calls < 3) return { status: "pending" };
        return { status: "success", url: "https://preview.example.com" };
      },
    });
    assert.equal(calls, 3);
    assert.equal(url, "https://preview.example.com");
  });

  it("times out when every poll stays pending past the deadline", async () => {
    let time = 0;
    await assert.rejects(
      waitForPreview({
        repo: "fernandolisboa/fetha",
        sha: "abc123",
        token: "token",
        timeoutMs: 1000,
        intervalMs: 500,
        now: () => time,
        sleep: async () => {
          time += 500;
        },
        poll: async () => ({ status: "pending" }),
      }),
      /Timed out waiting/,
    );
  });
});
