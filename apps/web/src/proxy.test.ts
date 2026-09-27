import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("sends one nonce in the policy and forwards the same policy to the render", () => {
    const response = proxy(new NextRequest("http://localhost/entrar"));

    const policy = response.headers.get("content-security-policy-report-only") ?? "";
    expect(policy).toMatch(/'nonce-[^']+'/);
    expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(
      policy,
    );
  });

  it("drops a policy the client sent, so it cannot choose the nonce Next stamps", () => {
    const response = proxy(
      new NextRequest("http://localhost/entrar", {
        headers: { "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='" },
      }),
    );

    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "content-security-policy-report-only",
    );
    expect(
      response.headers
        .get("x-middleware-override-headers")
        ?.split(",")
        .includes("content-security-policy"),
    ).toBe(false);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBeNull();
  });

  it("uses a new nonce for every request", () => {
    const first = proxy(new NextRequest("http://localhost/"));
    const second = proxy(new NextRequest("http://localhost/"));
    expect(first.headers.get("content-security-policy-report-only")).not.toBe(
      second.headers.get("content-security-policy-report-only"),
    );
  });

  it.each(["/", "/entrar", "/carteira", "/estrategias/abc/backtests/def", "/api-docs", "/iconsx"])(
    "runs on the page %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(true);
    },
  );

  it.each([
    "/api/auth/get-session",
    "/_next/static/chunks/main.js",
    "/sw.js",
    "/offline.html",
    "/icons/icon-192.png",
    "/favicon.ico",
    "/manifest.webmanifest",
  ])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(false);
  });

  it("runs on a document the browser prefetches or prerenders", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig,
        url: "/carteira",
        headers: { purpose: "prefetch" },
      }),
    ).toBe(true);
  });

  it("skips router prefetches", () => {
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
