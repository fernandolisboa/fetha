import { describe, expect, it } from "vitest";

import { themes } from "@fetha/contracts";

import { parseThemeTokens, readGlobalsCss } from "./parse-theme-tokens";

// Every token DESIGN.md lists under "Tokens" (CLAUDE.md mirrors the same
// list) must exist as a CSS custom property in each of the three themes.
const designTokens = [
  "--bg",
  "--surface",
  "--surface-2",
  "--line",
  "--line-soft",
  "--ink",
  "--muted",
  "--faint",
  "--accent",
  "--accent-hover",
  "--accent-ink",
  "--accent-soft",
  "--up",
  "--down",
  "--warning",
  "--danger",
  "--greek-delta",
  "--greek-gamma",
  "--greek-theta",
  "--greek-vega",
  "--font-display",
  "--font-body",
  "--font-mono",
  "--radius",
  "--elevation",
  "--density",
  "--chart-stroke",
];

describe("theme tokens", () => {
  const css = readGlobalsCss();

  it.each(themes)("defines every DESIGN.md token for the %s theme", (theme) => {
    const tokens = parseThemeTokens(css, theme);
    for (const token of designTokens) {
      expect(tokens, `missing ${token} in ${theme}`).toHaveProperty(token);
      expect(tokens[token]?.length, `${token} in ${theme} is empty`).toBeGreaterThan(0);
    }
  });
});
