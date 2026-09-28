#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SHA_PINNED = /^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/;
const DOCKER_SHA_PINNED = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

export function parseUsesValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const end = trimmed.indexOf(quote, 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  const match = trimmed.match(/^\S+/);
  return match ? match[0] : "";
}

export function findUsesEntries(content) {
  const entries = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*-?\s*uses:\s*(.+)$/);
    if (!match) continue;
    entries.push({ line: index + 1, value: parseUsesValue(match[1]) });
  }
  return entries;
}

export function validateUsesValue(value) {
  if (value.startsWith("./") || value.startsWith("../")) return null;
  if (value.startsWith("docker://")) {
    return DOCKER_SHA_PINNED.test(value)
      ? null
      : "docker `uses:` must be pinned as docker://image@sha256:<64-hex digest>";
  }
  return SHA_PINNED.test(value)
    ? null
    : "`uses:` must be pinned as owner/repo[/path]@<40-hex commit sha>";
}

function findYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      results.push(...findYamlFiles(entryPath));
    } else if (/\.ya?ml$/.test(entry)) {
      results.push(entryPath);
    }
  }
  return results;
}

export function findWorkflowFiles(repoRoot) {
  return [
    ...findYamlFiles(path.join(repoRoot, ".github", "workflows")),
    ...findYamlFiles(path.join(repoRoot, ".github", "actions")),
  ];
}

export function checkFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const violations = [];
  for (const entry of findUsesEntries(content)) {
    const message = validateUsesValue(entry.value);
    if (message) {
      violations.push({ file: filePath, line: entry.line, value: entry.value, message });
    }
  }
  return violations;
}

export function checkRepo(repoRoot) {
  return findWorkflowFiles(repoRoot).flatMap((filePath) => checkFile(filePath));
}

function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const violations = checkRepo(repoRoot);
  if (violations.length === 0) {
    console.log("ok - every `uses:` is pinned to a full commit sha");
    return;
  }
  console.error("not ok - unpinned `uses:` found");
  for (const violation of violations) {
    console.error(
      `${path.relative(repoRoot, violation.file)}:${violation.line}: ${violation.value} - ${violation.message}`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
