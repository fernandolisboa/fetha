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

  it("leaves build output to the precache", () => {
    expect(writesToCache(matchOptions("/_next/static/chunks/app-abc123.js", "no-cors"))).toBe(
      false,
    );
  });

  it("sends navigations to the network so the offline page can stand in", () => {
    expect(cachingEntryFor(matchOptions("/", "navigate"))?.handler).toBeInstanceOf(NetworkOnly);
  });
});

describe("isObsoleteCache", () => {
  it.each([
    "apis",
    "pages",
    "pages-rsc",
    "pages-rsc-prefetch",
    "others",
    "static-data-assets",
    "next-static",
    "next-static-js-assets",
  ])("deletes the old %s cache", (name) => {
    expect(isObsoleteCache(name)).toBe(true);
  });

  it("keeps the precache", () => {
    expect(isObsoleteCache("serwist-precache-v2-https://fetha.vercel.app/")).toBe(false);
  });
});
