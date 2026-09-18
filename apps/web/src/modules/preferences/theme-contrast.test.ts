import { describe, expect, it } from "vitest";

import { themes } from "./theme";

import { contrastRatio } from "@/lib/theme/contrast";
import { parseThemeTokens, readGlobalsCss } from "./test/parse-theme-tokens";

const textTokens = ["--ink", "--muted", "--faint"];
const semanticTokens = [
  "--up",
  "--down",
  "--warning",
  "--danger",
  "--greek-delta",
  "--greek-gamma",
  "--greek-theta",
  "--greek-vega",
  "--accent",
];

describe("theme contrast (DESIGN.md's design gate)", () => {
  const css = readGlobalsCss();

  it.each(themes)("text tokens meet 4.5:1 on --bg and --surface in %s", (theme) => {
    const tokens = parseThemeTokens(css, theme);
    for (const token of textTokens) {
      const value = tokens[token];
      if (!value) throw new Error(`missing ${token}`);
      expect(contrastRatio(value, tokens["--bg"] ?? "")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(value, tokens["--surface"] ?? "")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes)("chart and semantic tokens meet 3:1 on --bg in %s", (theme) => {
    const tokens = parseThemeTokens(css, theme);
    for (const token of semanticTokens) {
      const value = tokens[token];
      if (!value) throw new Error(`missing ${token}`);
      expect(contrastRatio(value, tokens["--bg"] ?? "")).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("contrastRatio input validation", () => {
  it("throws on a non-6-digit hex color", () => {
    expect(() => contrastRatio("#fff", "#000000")).toThrow();
    expect(() => contrastRatio("#000000", "#abc")).toThrow();
    expect(() => contrastRatio("not-a-color", "#000000")).toThrow();
  });
});
