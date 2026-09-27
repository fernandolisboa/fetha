import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("sends one nonce policy and forwards the same policy to the render", () => {
    const response = proxy(new NextRequest("http://localhost/entrar"));

    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
  });

  it("replaces a policy the client sent, so it cannot choose the nonce Next stamps", () => {
    const forged = "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='";
    const response = proxy(
      new NextRequest("http://localhost/entrar", {
        headers: { "content-security-policy": forged },
      }),
    );

    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
    expect(response.headers.get("content-security-policy")).not.toContain("AAAA");
  });

  it("uses a new nonce for every request", () => {
    const first = proxy(new NextRequest("http://localhost/"));
    const second = proxy(new NextRequest("http://localhost/"));
    expect(first.headers.get("content-security-policy")).not.toBe(
      second.headers.get("content-security-policy"),
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
    "/_next/image",
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
