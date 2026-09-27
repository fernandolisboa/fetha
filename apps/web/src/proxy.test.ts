import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("sends one nonce in the policy and forwards it to the render", () => {
    const response = proxy(new NextRequest("http://localhost/entrar"));

    const policy = response.headers.get("content-security-policy-report-only") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(
      policy,
    );
  });

  it("uses a new nonce for every request", () => {
    const first = proxy(new NextRequest("http://localhost/"));
    const second = proxy(new NextRequest("http://localhost/"));
    expect(first.headers.get("x-middleware-request-x-nonce")).not.toBe(
      second.headers.get("x-middleware-request-x-nonce"),
    );
  });

  it.each(["/", "/entrar", "/carteira", "/estrategias/abc/backtests/def"])(
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
