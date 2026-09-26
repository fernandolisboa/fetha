import { describe, expect, it } from "vitest";
import { NetworkOnly, type RouteMatchCallbackOptions } from "serwist";

import { isObsoleteCache, runtimeCaching } from "./pwa-cache";

const ORIGIN = "https://fetha.vercel.app";

function matchOptions(path: string, mode: RequestMode, headers: HeadersInit = {}) {
  const url = new URL(path, ORIGIN);
  return {
    url,
    sameOrigin: url.origin === ORIGIN,
    request: { mode, headers: new Headers(headers), url: url.href } as unknown as Request,
    event: {} as ExtendableEvent,
  };
}

function cachingEntryFor(options: RouteMatchCallbackOptions) {
  return runtimeCaching.find((entry) => {
    if (typeof entry.matcher !== "function") {
      throw new Error("every matcher is a function so this test can evaluate it");
    }
    return entry.matcher(options);
  });
}

function writesToCache(options: RouteMatchCallbackOptions): boolean {
  const entry = cachingEntryFor(options);
  return entry !== undefined && !(entry.handler instanceof NetworkOnly);
}

describe("service worker runtime caching", () => {
  it.each([
    ["the session endpoint", "/api/auth/get-session", "cors"],
    ["any other API route", "/api/backtests/abc/run", "cors"],
    ["the signed-in home page", "/", "navigate"],
    ["a portfolio page", "/carteira", "navigate"],
    ["an RSC payload", "/carteira?_rsc=1", "cors"],
    ["a JSON file", "/data.json", "cors"],
  ] as const)("never caches %s", (_label, path, mode) => {
    expect(writesToCache(matchOptions(path, mode, { RSC: "1" }))).toBe(false);
  });

  it("caches content-hashed build output", () => {
    expect(writesToCache(matchOptions("/_next/static/chunks/app-abc123.js", "no-cors"))).toBe(true);
  });

  it("sends navigations to the network so the offline page can stand in", () => {
    expect(cachingEntryFor(matchOptions("/", "navigate"))?.handler).toBeInstanceOf(NetworkOnly);
  });

  it("ignores another origin's build output", () => {
    expect(
      writesToCache(matchOptions("https://cdn.example/_next/static/chunks/x.js", "no-cors")),
    ).toBe(false);
  });
});

describe("isObsoleteCache", () => {
  it.each(["apis", "pages", "pages-rsc", "pages-rsc-prefetch", "others", "static-data-assets"])(
    "deletes the old %s cache",
    (name) => {
      expect(isObsoleteCache(name)).toBe(true);
    },
  );

  it("keeps the precache and the static build cache", () => {
    expect(isObsoleteCache("serwist-precache-v2-https://fetha.vercel.app/")).toBe(false);
    expect(isObsoleteCache("next-static")).toBe(false);
  });
});
