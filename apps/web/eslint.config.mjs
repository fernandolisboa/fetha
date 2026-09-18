import { readdirSync } from "node:fs";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

// Every vertical slice under src/modules/<name> (docs/adr/0019): the
// dependency rule below is generated from this list so a new module never
// needs a hand-written zone.
const moduleNames = readdirSync(new URL("./src/modules/", import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// The only paths another module (or src/app, or src/db) may import: the
// module's public surface (index.ts, client.ts) or its Drizzle tables
// (schema.ts, or schema/index.ts for modules with more than one table file).
const moduleEntryPoints = ["index.ts", "client.ts", "schema.ts", "schema/index.ts"];
const schemaEntryPoints = ["schema.ts", "schema/index.ts"];

const crossModuleZones = moduleNames.flatMap((target) =>
  moduleNames
    .filter((from) => from !== target)
    .map((from) => ({
      target: `./src/modules/${target}`,
      from: `./src/modules/${from}`,
      except: moduleEntryPoints,
    })),
);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["src/app/sw.ts", "playwright.config.ts", "e2e/**/*.ts", "drizzle.config.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // ADR-0019: a module's tables and internals are private; the rest of the
  // app reaches them only through index.ts, client.ts or a schema entry
  // point. Integration tests and src/db/test are exempt because they seed
  // reference data through module-private repositories on purpose (see the
  // comment in src/modules/market-data/index.ts).
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["**/*.integration.test.ts", "src/db/test/**"],
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            ...crossModuleZones,
            {
              target: "./src/app",
              from: "./src/modules/*",
              except: moduleEntryPoints,
            },
            {
              target: "./src/db",
              from: "./src/modules/*",
              except: schemaEntryPoints,
            },
            {
              target: "./src/lib",
              from: "./src/modules/*",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/sw.js", "drizzle/**"]),
]);

export default eslintConfig;
