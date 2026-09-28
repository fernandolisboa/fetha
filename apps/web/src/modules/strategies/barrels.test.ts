import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const moduleDir = import.meta.dirname;

function reExportedFiles(barrel: string): string[] {
  const source = readFileSync(path.join(moduleDir, barrel), "utf8");
  return [...source.matchAll(/^export\s[^;]*?from\s+"(\.[^"]+)"/gm)].map(([, specifier]) => {
    const base = path.join(moduleDir, specifier ?? "");
    const file = [".ts", ".tsx"].map((extension) => base + extension).find(existsSync);
    if (file === undefined) throw new Error(`unresolved re-export ${specifier ?? ""}`);
    return file;
  });
}

function isClientModule(file: string): boolean {
  return /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*["']use client["']/.test(
    readFileSync(file, "utf8"),
  );
}

describe("strategies barrels (#218)", () => {
  it("index.ts re-exports no client component", () => {
    const files = reExportedFiles("index.ts");
    expect(files.length).toBeGreaterThan(0);
    const clientFiles = files.filter(isClientModule).map((file) => path.relative(moduleDir, file));
    expect(clientFiles).toEqual([]);
  });
});
