#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_API = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;

export function selectPreviewDeployment(deployments) {
  const candidates = (deployments ?? []).filter(
    (deployment) =>
      deployment?.environment === "Preview" && deployment?.creator?.login === "vercel[bot]",
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    new Date(current.created_at).getTime() > new Date(latest.created_at).getTime()
      ? current
      : latest,
  );
}

export function classifyStatuses(statuses) {
  const latest = (statuses ?? [])[0];
  if (!latest) return { status: "pending" };
  if (latest.state === "success") {
    if (!latest.environment_url) {
      return { status: "failure", reason: "success status has no environment_url" };
    }
    return { status: "success", url: latest.environment_url };
  }
  if (latest.state === "failure" || latest.state === "error") {
    return { status: "failure", reason: `deployment status is ${latest.state}` };
  }
  return { status: "pending" };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API request to ${url} failed with ${response.status}`);
  }
  return response.json();
}

async function pollGitHub({ repo, sha, token }) {
  const deployments = await fetchJson(`${GITHUB_API}/repos/${repo}/deployments?sha=${sha}`, token);
  const deployment = selectPreviewDeployment(deployments);
  if (!deployment) return { status: "pending" };
  const statuses = await fetchJson(
    `${GITHUB_API}/repos/${repo}/deployments/${deployment.id}/statuses`,
    token,
  );
  return classifyStatuses(statuses);
}

export async function waitForPreview({
  repo,
  sha,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  poll = pollGitHub,
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const result = await poll({ repo, sha, token });
    if (result.status === "success") return result.url;
    if (result.status === "failure") {
      throw new Error(`Vercel preview deployment failed: ${result.reason ?? "unknown reason"}`);
    }
    if (now() >= deadline) {
      throw new Error(`Timed out waiting for a Vercel preview deployment for ${sha}`);
    }
    await sleep(intervalMs);
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.PREVIEW_SHA;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  if (!sha) throw new Error("PREVIEW_SHA is not set");
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const timeoutMs = process.env.PREVIEW_TIMEOUT_MS
    ? Number(process.env.PREVIEW_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  const intervalMs = process.env.PREVIEW_POLL_INTERVAL_MS
    ? Number(process.env.PREVIEW_POLL_INTERVAL_MS)
    : DEFAULT_POLL_INTERVAL_MS;

  const url = await waitForPreview({ repo, sha, token, timeoutMs, intervalMs });
  console.log(`Vercel preview ready: ${url}`);

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `url=${url}\n`);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
