---
status: accepted
date: 2026-09-26
---

# The PWA caches build output only; pages and API responses never reach Cache Storage

## Context

`CLAUDE.md` promises "Offline: cached shell only", but the service worker used `@serwist/next`'s
`defaultCache`. That list caches every same-origin `GET /api/*` response (`NetworkFirst`, 24 h,
including `/api/auth/get-session` with the user's name and email) and every page, RSC payload and
JSON file under the catch-all "others", "pages" and "pages-rsc" caches. After sign-out those
entries stayed on the device for up to a day and were served offline, readable by whoever uses
the machine next (security audit A-03, #43). Portfolio and decision pages now render the user's
fills and journal, so the exposure grew with each feature.

## Decision

1. Runtime caching is an explicit list in `apps/web/src/app/pwa-cache.ts`: `CacheFirst` for
   same-origin `/_next/static/*` (content-hashed build output) and `NetworkOnly` for navigations.
   Nothing else has a route, so API calls, RSC payloads and other fetches go straight to the
   network and are never stored.
2. The precache is what `@serwist/next` builds from the Next output and `public/`: static
   chunks, fonts, icons and `public/offline.html`.
3. A navigation that fails offline falls back to `public/offline.html`, a static page with no
   user data. It is plain HTML so that precaching it never captures a signed-in render (the root
   layout reads the session).
4. On activation the worker deletes every cache that is neither Serwist's own (`serwist-*`) nor
   the static cache, which removes what `defaultCache` left on installed clients.
5. Since no user data is cached, sign-out needs no cache step.

## Considered options

- **Keep `defaultCache` and clear caches on sign-out.** Rejected: data would still sit on disk
  for any session that ends by expiry or by closing the window, and a crash between writes and
  sign-out leaves it there.
- **Cache pages but key them by user.** Rejected: the product is desktop-first and online; an
  offline read of stale portfolio data has no use that justifies storing it.

## Consequences

- Offline, the installed app opens the static "Sem conexão" page instead of the last page seen.
- Every page load hits the network; static assets still come from the precache.
- Any new runtime route must be added to `pwa-cache.ts` and its test, which asserts that no
  route stores `/api/*`, navigations or RSC payloads.
