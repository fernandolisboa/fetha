import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "coverage", "eslint.config.js", "vitest.config.ts"]),
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:fs", message: "The engine is pure: no I/O." },
            { name: "fs", message: "The engine is pure: no I/O." },
            { name: "node:http", message: "The engine is pure: no I/O." },
            { name: "node:https", message: "The engine is pure: no I/O." },
            { name: "node:child_process", message: "The engine is pure: no I/O." },
            { name: "react", message: "The engine has zero framework imports." },
            { name: "next", message: "The engine has zero framework imports." },
            {
              name: "@fetha/contracts",
              allowTypeImports: true,
              message: "The engine imports contracts as types only (ADR-0013).",
            },
          ],
          patterns: ["next/*", "drizzle-orm*", "@fetha/web*"],
        },
      ],
    },
  },
  {
    // The sole exception to "contracts as types only" (ADR-0013): the branded scalar
    // constructors build through the real Zod schemas so validation is enforced at
    // construction, confined to this one file.
    files: ["src/internal/scalar-schemas.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);
