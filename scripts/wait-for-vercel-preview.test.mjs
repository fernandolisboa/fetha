import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyStatuses,
  orderedFallbackShas,
  resolvePreviewOnce,
  selectPreviewDeployment,
  wasBuildIgnored,
  waitForPreview,
} from "./wait-for-vercel-preview.mjs";

const VERCEL_BOT = { login: "vercel[bot]" };
const TRUSTED_URL = "https://fetha-xxxx-feuxs-projects.vercel.app";

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

  it("reports success with the environment_url from the newest terminal status", () => {
    const statuses = [{ state: "success", environment_url: TRUSTED_URL }, { state: "queued" }];
    assert.deepEqual(classifyStatuses(statuses), { status: "success", url: TRUSTED_URL });
  });

  it("treats a success status missing environment_url as a failure", () => {
    const result = classifyStatuses([{ state: "success" }]);
    assert.equal(result.status, "failure");
  });

  it("treats a success status with a non-vercel.app host as a failure", () => {
    const result = classifyStatuses([
      { state: "success", environment_url: "https://evil.example.com" },
    ]);
    assert.equal(result.status, "failure");
  });

  it("treats a success status with a non-https environment_url as a failure", () => {
    const result = classifyStatuses([
      { state: "success", environment_url: "http://fetha-xxxx.vercel.app" },
    ]);
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

  it("skips a newer inactive entry and finds the earlier success (auto_inactive)", () => {
    const statuses = [{ state: "inactive" }, { state: "success", environment_url: TRUSTED_URL }];
    assert.deepEqual(classifyStatuses(statuses), { status: "success", url: TRUSTED_URL });
  });

  it("skips pending/queued/in_progress entries newer than a terminal one", () => {
    const statuses = [{ state: "queued" }, { state: "in_progress" }, { state: "failure" }];
    assert.equal(classifyStatuses(statuses).status, "failure");
  });
});

describe("wasBuildIgnored", () => {
  it("returns true when the newest Vercel commit status describes an ignored build", () => {
    const statuses = [
      { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
      { context: "Vercel", state: "pending", description: "Vercel is deploying your app" },
    ];
    assert.equal(wasBuildIgnored(statuses), true);
  });

  it("returns false when the newest Vercel commit status is a real deployment", () => {
    const statuses = [{ context: "Vercel", state: "success", description: "Deployment ready" }];
    assert.equal(wasBuildIgnored(statuses), false);
  });

  it("returns false when there is no Vercel commit status yet", () => {
    assert.equal(wasBuildIgnored([{ context: "other", state: "success" }]), false);
    assert.equal(wasBuildIgnored([]), false);
  });
});

describe("orderedFallbackShas", () => {
  it("excludes the head sha and reverses oldest-to-newest into newest-to-oldest", () => {
    const commits = [{ sha: "a" }, { sha: "b" }, { sha: "c" }];
    assert.deepEqual(orderedFallbackShas(commits, "c"), ["b", "a"]);
  });

  it("returns an empty list when head is the only commit", () => {
    assert.deepEqual(orderedFallbackShas([{ sha: "a" }], "a"), []);
  });
});

describe("resolvePreviewOnce", () => {
  const base = { repo: "fernandolisboa/fetha", sha: "head-sha", prNumber: "42", token: "t" };

  it("returns the head deployment classification when it exists", () => {
    const io = {
      getDeploymentStatus: async () => ({
        ok: true,
        found: true,
        classification: { status: "success", url: TRUSTED_URL },
      }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "success", url: TRUSTED_URL });
    });
  });

  it("reports pending when head has no deployment and was not ignored", () => {
    const io = {
      getDeploymentStatus: async () => ({ ok: true, found: false }),
      getCommitStatuses: async () => ({
        ok: true,
        data: [
          { context: "Vercel", state: "pending", description: "Vercel is deploying your app" },
        ],
      }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "pending" });
    });
  });

  it("falls back to the newest earlier commit with a deployment when head was ignored", () => {
    const io = {
      getDeploymentStatus: async (repo, sha) => {
        if (sha === "head-sha") return { ok: true, found: false };
        if (sha === "older-2") return { ok: true, found: false };
        if (sha === "older-1") {
          return {
            ok: true,
            found: true,
            classification: { status: "success", url: TRUSTED_URL },
          };
        }
        throw new Error(`unexpected sha ${sha}`);
      },
      getCommitStatuses: async () => ({
        ok: true,
        data: [
          { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
        ],
      }),
      getPRCommits: async () => ({
        ok: true,
        data: [{ sha: "older-1" }, { sha: "older-2" }, { sha: "head-sha" }],
      }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "success", url: TRUSTED_URL });
    });
  });

  it("reports skip when the whole PR is docs-only (no earlier commit ever built)", () => {
    const io = {
      getDeploymentStatus: async () => ({ ok: true, found: false }),
      getCommitStatuses: async () => ({
        ok: true,
        data: [
          { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
        ],
      }),
      getPRCommits: async () => ({ ok: true, data: [{ sha: "head-sha" }] }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "skip" });
    });
  });

  it("reports api-error when the head deployment lookup fails", () => {
    const io = { getDeploymentStatus: async () => ({ ok: false }) };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "api-error" });
    });
  });

  it("reports api-error when the commit statuses lookup fails", () => {
    const io = {
      getDeploymentStatus: async () => ({ ok: true, found: false }),
      getCommitStatuses: async () => ({ ok: false }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "api-error" });
    });
  });

  it("reports api-error when the PR commits lookup fails", () => {
    const io = {
      getDeploymentStatus: async () => ({ ok: true, found: false }),
      getCommitStatuses: async () => ({
        ok: true,
        data: [
          { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
        ],
      }),
      getPRCommits: async () => ({ ok: false }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "api-error" });
    });
  });

  it("reports api-error when a fallback candidate's deployment lookup fails", () => {
    const io = {
      getDeploymentStatus: async (repo, sha) => {
        if (sha === "head-sha") return { ok: true, found: false };
        return { ok: false };
      },
      getCommitStatuses: async () => ({
        ok: true,
        data: [
          { context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" },
        ],
      }),
      getPRCommits: async () => ({ ok: true, data: [{ sha: "older-1" }, { sha: "head-sha" }] }),
    };
    return resolvePreviewOnce({ ...base, io }).then((result) => {
      assert.deepEqual(result, { status: "api-error" });
    });
  });
});

describe("waitForPreview", () => {
  it("returns the url as soon as resolveOnce reports success", async () => {
    const { url } = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      prNumber: "1",
      token: "token",
      resolveOnce: async () => ({ status: "success", url: TRUSTED_URL }),
      sleep: async () => {
        throw new Error("should not sleep when the first poll succeeds");
      },
    });
    assert.equal(url, TRUSTED_URL);
  });

  it("returns a null url when resolveOnce reports skip (docs-only PR)", async () => {
    const { url } = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      prNumber: "1",
      token: "token",
      resolveOnce: async () => ({ status: "skip" }),
    });
    assert.equal(url, null);
  });

  it("throws when resolveOnce reports failure", async () => {
    await assert.rejects(
      waitForPreview({
        repo: "fernandolisboa/fetha",
        sha: "abc123",
        prNumber: "1",
        token: "token",
        resolveOnce: async () => ({ status: "failure", reason: "deployment status is error" }),
      }),
      /deployment status is error/,
    );
  });

  it("polls again on pending, then resolves on success", async () => {
    let calls = 0;
    const { url } = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      prNumber: "1",
      token: "token",
      now: () => 0,
      timeoutMs: 60_000,
      sleep: async () => {},
      resolveOnce: async () => {
        calls += 1;
        if (calls < 3) return { status: "pending" };
        return { status: "success", url: TRUSTED_URL };
      },
    });
    assert.equal(calls, 3);
    assert.equal(url, TRUSTED_URL);
  });

  it("times out when every poll stays pending past the deadline", async () => {
    let time = 0;
    await assert.rejects(
      waitForPreview({
        repo: "fernandolisboa/fetha",
        sha: "abc123",
        prNumber: "1",
        token: "token",
        timeoutMs: 1000,
        intervalMs: 500,
        now: () => time,
        sleep: async () => {
          time += 500;
        },
        resolveOnce: async () => ({ status: "pending" }),
      }),
      /Timed out waiting/,
    );
  });

  it("treats an api-error as pending and keeps polling", async () => {
    let calls = 0;
    const { url } = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      prNumber: "1",
      token: "token",
      now: () => 0,
      timeoutMs: 60_000,
      sleep: async () => {},
      resolveOnce: async () => {
        calls += 1;
        if (calls <= 3) return { status: "api-error" };
        return { status: "success", url: TRUSTED_URL };
      },
    });
    assert.equal(calls, 4);
    assert.equal(url, TRUSTED_URL);
  });

  it("gives up after 5 consecutive api errors", async () => {
    let calls = 0;
    await assert.rejects(
      waitForPreview({
        repo: "fernandolisboa/fetha",
        sha: "abc123",
        prNumber: "1",
        token: "token",
        now: () => 0,
        timeoutMs: 60_000,
        sleep: async () => {},
        resolveOnce: async () => {
          calls += 1;
          return { status: "api-error" };
        },
      }),
      /GitHub API failed 5 times in a row/,
    );
    assert.equal(calls, 5);
  });

  it("resets the api-error count after a successful poll", async () => {
    let calls = 0;
    const { url } = await waitForPreview({
      repo: "fernandolisboa/fetha",
      sha: "abc123",
      prNumber: "1",
      token: "token",
      now: () => 0,
      timeoutMs: 60_000,
      sleep: async () => {},
      resolveOnce: async () => {
        calls += 1;
        // Four errors, then three pendings (resetting the counter each
        // time), then success: never hits the five-in-a-row ceiling.
        if (calls <= 4) return { status: "api-error" };
        if (calls <= 7) return { status: "pending" };
        return { status: "success", url: TRUSTED_URL };
      },
    });
    assert.equal(calls, 8);
    assert.equal(url, TRUSTED_URL);
  });
});
