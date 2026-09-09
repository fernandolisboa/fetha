import type { BacktestConfig } from "../api";

// A pure, dependency-free digest (no `node:crypto`, keeping the engine platform-agnostic per
// ADR-0013): FNV-1a 32-bit over a canonical (sorted-key) JSON encoding of the config, so the
// same config always digests to the same string regardless of key order.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function configDigest(config: BacktestConfig): string {
  return fnv1a(JSON.stringify(canonicalize(config)));
}
