import { CacheFirst, NetworkOnly, type RuntimeCaching } from "serwist";

export const OFFLINE_FALLBACK_URL = "/offline.html";

export const STATIC_ASSETS_CACHE = "next-static";

// "Offline: cached shell only" (CLAUDE.md, docs/adr/0025): only content-hashed
// build output is cached at runtime. Pages, RSC payloads and /api/* never go
// into Cache Storage, because they carry the signed-in user's data and would
// outlive sign-out on the device (#43). Navigations go to the network and fall
// back to a static offline page.
export const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({ cacheName: STATIC_ASSETS_CACHE }),
  },
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkOnly(),
  },
];

// Caches written by @serwist/next's defaultCache before #43, some holding
// pages and API responses; deleted when this worker activates.
export function isObsoleteCache(name: string): boolean {
  return !name.startsWith("serwist-") && name !== STATIC_ASSETS_CACHE;
}
