import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
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
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/sw.js", "drizzle/**"]),
]);

export default eslintConfig;
