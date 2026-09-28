#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_API = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;
const MAX_CONSECUTIVE_API_ERRORS = 5;

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

function isTrustedPreviewUrl(url) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.endsWith(".vercel.app");
}

export function classifyStatuses(statuses) {
  for (const entry of statuses ?? []) {
    if (entry?.state === "success") {
      if (!isTrustedPreviewUrl(entry.environment_url)) {
        return {
          status: "failure",
          reason: "success status has a missing or untrusted environment_url",
        };
      }
      return { status: "success", url: entry.environment_url };
    }
    if (entry?.state === "failure" || entry?.state === "error") {
      return { status: "failure", reason: `deployment status is ${entry.state}` };
    }
    // pending/queued/in_progress/inactive: not a terminal state yet, keep
    // looking at older entries (GitHub appends "inactive" to a deployment
    // that already succeeded once a newer one takes over the environment;
    // that does not undo the earlier success).
  }
  return { status: "pending" };
}

export function findVercelCommitStatus(commitStatuses) {
  return (commitStatuses ?? []).find((entry) => entry?.context === "Vercel") ?? null;
}

export function wasBuildIgnored(commitStatuses) {
  const vercelStatus = findVercelCommitStatus(commitStatuses);
  if (!vercelStatus) return false;
  return /ignored build step/i.test(vercelStatus.description ?? "");
}

export function orderedFallbackShas(commits, headSha) {
  return (commits ?? [])
    .map((commit) => commit?.sha)
    .filter((sha) => sha && sha !== headSha)
    .reverse();
}

async function githubFetch(url, token) {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function tryFetchJson(url, token) {
  try {
    const response = await githubFetch(url, token);
    if (!response.ok) return { ok: false };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  }
}

// GitHub caps this endpoint at 100 items per page; a PR with more commits
// than that would silently hide the commit we should fall back to (or
// falsely report none exists). Rather than paginate for a case this rare,
// the caller treats a truncated page as unresolved.
function hasNextPage(response) {
  return /<[^>]+>\s*;\s*rel="next"/.test(response.headers.get("link") ?? "");
}

async function tryFetchJsonPage(url, token) {
  try {
    const response = await githubFetch(url, token);
    if (!response.ok) return { ok: false };
    const data = await response.json();
    return { ok: true, data, truncated: hasNextPage(response) || data.length === 100 };
  } catch {
    return { ok: false };
  }
}

async function getDeploymentStatus(repo, sha, token) {
  const deployments = await tryFetchJson(
    `${GITHUB_API}/repos/${repo}/deployments?sha=${sha}`,
    token,
  );
  if (!deployments.ok) return { ok: false };
  const deployment = selectPreviewDeployment(deployments.data);
  if (!deployment) return { ok: true, found: false };
  const statuses = await tryFetchJson(
    `${GITHUB_API}/repos/${repo}/deployments/${deployment.id}/statuses`,
    token,
  );
  if (!statuses.ok) return { ok: false };
  return { ok: true, found: true, classification: classifyStatuses(statuses.data) };
}

const defaultIo = {
  getDeploymentStatus,
  getCommitStatuses(repo, sha, token) {
    return tryFetchJson(`${GITHUB_API}/repos/${repo}/commits/${sha}/statuses`, token);
  },
  getPRCommits(repo, prNumber, token) {
    return tryFetchJsonPage(
      `${GITHUB_API}/repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
      token,
    );
  },
};

// Vercel diffs the commit it is about to build against the *last commit it
// actually built*, not against the PR as a whole (ignoreCommand runs per
// push). A docs-only commit on top of a code commit therefore never gets a
// GitHub deployment; Vercel posts only a "Vercel" commit status describing
// it as ignored. When that happens, the code under test is still the
// nearest earlier commit that did build, so this walks the PR's commit
// history backwards from (but excluding) head and adopts the first one
// with any Preview deployment at all as the new target.
export async function resolvePreviewOnce({ repo, sha, prNumber, token, io = defaultIo }) {
  const head = await io.getDeploymentStatus(repo, sha, token);
  if (!head.ok) return { status: "api-error" };
  if (head.found) return head.classification;

  const commitStatuses = await io.getCommitStatuses(repo, sha, token);
  if (!commitStatuses.ok) return { status: "api-error" };
  const vercelStatus = findVercelCommitStatus(commitStatuses.data);
  if (!wasBuildIgnored(commitStatuses.data)) {
    return { status: "pending", vercelStatus };
  }

  const prCommits = await io.getPRCommits(repo, prNumber, token);
  if (!prCommits.ok) return { status: "api-error" };
  if (prCommits.truncated) {
    // Never guess: adopting an arbitrary earlier commit off a truncated
    // page could run e2e against the wrong (stale) preview. A false green
    // is worse than a red timeout, so this stays pending forever rather
    // than picking a candidate we can't be sure is the newest built one.
    return { status: "pending", vercelStatus };
  }
  const fallbackShas = orderedFallbackShas(prCommits.data, sha);

  for (const candidateSha of fallbackShas) {
    const candidate = await io.getDeploymentStatus(repo, candidateSha, token);
    if (!candidate.ok) return { status: "api-error" };
    if (candidate.found) return candidate.classification;
  }

  return { status: "skip", vercelStatus };
}

function timeoutMessage(sha, vercelStatus) {
  const base = `Timed out waiting for a Vercel preview deployment for ${sha}`;
  if (!vercelStatus) return base;
  return `${base} (last observed "Vercel" commit status: state=${vercelStatus.state ?? "unknown"}, description=${JSON.stringify(vercelStatus.description ?? "")})`;
}

export async function waitForPreview({
  repo,
  sha,
  prNumber,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resolveOnce = resolvePreviewOnce,
}) {
  const deadline = now() + timeoutMs;
  let consecutiveApiErrors = 0;
  let lastVercelStatus = null;
  for (;;) {
    const result = await resolveOnce({ repo, sha, prNumber, token });
    if (result.vercelStatus) lastVercelStatus = result.vercelStatus;
    if (result.status === "api-error") {
      consecutiveApiErrors += 1;
      if (consecutiveApiErrors >= MAX_CONSECUTIVE_API_ERRORS) {
        throw new Error(
          `GitHub API failed ${MAX_CONSECUTIVE_API_ERRORS} times in a row while waiting for the preview deployment`,
        );
      }
    } else {
      consecutiveApiErrors = 0;
      if (result.status === "success") return { url: result.url };
      if (result.status === "skip") return { url: null };
      if (result.status === "failure") {
        throw new Error(`Vercel preview deployment failed: ${result.reason ?? "unknown reason"}`);
      }
    }
    if (now() >= deadline) {
      throw new Error(timeoutMessage(sha, lastVercelStatus));
    }
    await sleep(intervalMs);
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.PREVIEW_SHA;
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  if (!sha) throw new Error("PREVIEW_SHA is not set");
  if (!prNumber) throw new Error("PR_NUMBER is not set");
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const { url } = await waitForPreview({ repo, sha, prNumber, token });

  if (!url) {
    console.log(
      `No Vercel preview deployment exists for ${sha} or any earlier commit on this PR; skipping e2e.`,
    );
    return;
  }

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
