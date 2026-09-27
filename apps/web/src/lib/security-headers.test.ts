import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { config } from "../proxy";

async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const matching = rules.filter((rule) =>
    new RegExp(buildCustomRoute("header", rule).regex).test(path),
  );
  return new Map(matching.flatMap((rule) => rule.headers.map((h) => [h.key, h.value])));
}

const documents = ["/", "/entrar", "/carteira", "/api-docs", "/iconsx", "/sw.jsx"];
const nonDocuments = [
  "/api/auth/get-session",
  "/api",
  "/_next/static/chunks/main.js",
  "/_next/image",
  "/icons/icon-192.png",
  "/favicon.ico",
  "/sw.js",
  "/offline.html",
  "/manifest.webmanifest",
];

describe("security headers", () => {
  it.each([...documents, ...nonDocuments])("are sent on %s", async (path) => {
    const headers = await headersFor(path);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it.each(nonDocuments)(
    "carry the static policy on %s, which the proxy excludes by name",
    async (path) => {
      expect((await headersFor(path)).get("Content-Security-Policy")).toBe(
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      );
      expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: path })).toBe(false);
    },
  );

  it.each(documents)("leave the policy of %s to the proxy alone", async (path) => {
    expect((await headersFor(path)).has("Content-Security-Policy")).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: path })).toBe(true);
  });

  it("leave a router prefetch, which is never a document, with neither policy", async () => {
    expect((await headersFor("/carteira")).has("Content-Security-Policy")).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig,
        url: "/carteira",
        headers: { "next-router-prefetch": "1" },
      }),
    ).toBe(false);
  });
});
