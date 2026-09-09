import { readFileSync } from "node:fs";
import path from "node:path";

import type { Theme } from "@fetha/contracts";

export type ThemeTokens = Record<string, string>;

const GLOBALS_CSS_PATH = path.resolve(import.meta.dirname, "../../app/globals.css");

function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`selector not found in globals.css: ${selector}`);
  }
  const openBrace = css.indexOf("{", start);
  const closeBrace = css.indexOf("}", openBrace);
  return css.slice(openBrace + 1, closeBrace);
}

function parseDeclarations(block: string): ThemeTokens {
  const tokens: ThemeTokens = {};
  for (const line of block.split(";")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("--")) {
      continue;
    }
    const colonIndex = trimmed.indexOf(":");
    const name = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    tokens[name] = value;
  }
  return tokens;
}

export function readGlobalsCss(): string {
  return readFileSync(GLOBALS_CSS_PATH, "utf-8");
}

export function parseThemeTokens(css: string, theme: Theme): ThemeTokens {
  const selector =
    theme === "instrumento" ? `:root[data-theme="instrumento"]` : `:root[data-theme="${theme}"]`;
  return parseDeclarations(extractBlock(css, selector));
}
