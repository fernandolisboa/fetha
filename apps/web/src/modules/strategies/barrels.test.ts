import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const moduleDir = import.meta.dirname;

function reExportedFiles(barrel: string): string[] {
  const source = readFileSync(path.join(moduleDir, barrel), "utf8");
  return [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map(([, specifier]) => {
    const base = path.join(moduleDir, specifier ?? "");
    const file = [".ts", ".tsx"].map((extension) => base + extension).find(existsSync);
    if (file === undefined) throw new Error(`unresolved re-export ${specifier ?? ""}`);
    return file;
  });
}

function isClientModule(file: string): boolean {
  return /^\s*["']use client["']/.test(readFileSync(file, "utf8"));
}

describe("strategies barrels (#218)", () => {
  it("client.ts re-exports only client components", () => {
    const files = reExportedFiles("client.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => !isClientModule(file))).toEqual([]);
  });

  it("index.ts re-exports no client component", () => {
    const clientFiles = reExportedFiles("index.ts")
      .filter(isClientModule)
      .map((file) => path.relative(moduleDir, file));
    expect(clientFiles).toEqual([]);
  });
});
