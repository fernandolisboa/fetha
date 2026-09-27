---
status: accepted
date: 2026-09-27
---

# Documents enforce a nonce script-src from the proxy; the report-only step is skipped (amends 0026)

## Context

ADR-0026 left `script-src` unset and planned a nonce policy "introduced report-only first and
enforced once a preview shows no violations" (#125). Next stamps its own scripts with the nonce
it parses from the render request's `Content-Security-Policy` header and falls back to
`Content-Security-Policy-Report-Only` only when the first is absent
(`next/dist/server/app-render/app-render.js`). A report-only step built that way (the first
commits of PR #161) worked on a local production build. On its Vercel preview, though, the page
carried the report-only nonce header and no script carried a nonce, even when the request
brought a forged nonce policy of its own. The render saw a policy without a nonce, which can
only be the static `Content-Security-Policy` that ADR-0026 sends from `next.config.ts`. So while any
enforced policy without a nonce sits on a document, a report-only nonce policy cannot work, and
removing the enforced one for the trial would drop `frame-ancestors`, `form-action`,
`base-uri` and `object-src` from every page.

## Decision

1. Every routed page gets exactly one policy, set by `apps/web/src/proxy.ts` on both the forwarded
   request and the response, with a fresh 128-bit nonce per request
   (`apps/web/src/lib/document-policy.ts`):
   `script-src 'self' 'nonce-…' 'strict-dynamic'; worker-src 'self'; frame-ancestors 'none';
base-uri 'self'; form-action 'self'; object-src 'none'`.
   - `'strict-dynamic'` makes browsers ignore `'self'` for scripts, so the service worker
     (ADR-0025) needs its own `worker-src 'self'`.
   - `'unsafe-eval'` is added in development only, for React's development build.
   - A policy sent by the client is replaced, so it cannot choose the nonce Next stamps.
2. `next.config.ts` sends ADR-0026's static policy only on the paths the proxy skips (API
   routes, `/_next/*`, icons, `favicon.ico`, `sw.js`, `offline.html`, the manifest). A unit test
   holds the two sets as complements. The other four headers of ADR-0026 stay on every path.
3. The proxy skips the router's own RSC prefetches, which are never documents. Documents the
   browser prefetches or prerenders (`Purpose: prefetch`) get the policy.
4. Zod runs `jitless` in the browser (`instrumentation-client.ts`): its `new Function` probe is
   caught, but it still counts as a violation.
5. The report-only trial is replaced by walks before merge:
   - **Local, every flow.** The whole Playwright suite ran against a local production build of
     this policy, with a `report-uri` added for that run only and pointed at a local collector.
     It covered the signed-in flows: charts, the strategy editor, backtests, the B3 import,
     dialogs and the service worker. The collector received no report.
   - **Preview, public pages.** On the Vercel preview, every script on the eleven public pages
     carried the header's nonce, also when the request brought a forged policy, and a browser
     visit raised no `securitypolicyviolation`.
   - **Signed-in pages were not walked on the preview.** Signing in there from an agent session
     needs `E2E_SECRET`, a sensitive Vercel value no agent can read. The nonce is stamped by the
     same proxy and render path on every dynamic route, and that path is what differed between
     the local build and Vercel.
     `e2e/security-headers.spec.ts` keeps the nonce and violation checks. No CI job runs
     Playwright, so they run by hand against a deployment through `PLAYWRIGHT_BASE_URL`.

## Consequences

- A `<script>`, inline event handler or `javascript:` URL injected into a page's markup no
  longer runs, so React's escaping is no longer the only defence. `'strict-dynamic'` still lets
  a script that already runs create more scripts through DOM APIs; that is the price of not
  listing Next's chunks.
- Every page must render dynamically for the nonce. The root layout reads the session, so it
  already does. A page made static would ship scripts without a nonce and break, and the e2e
  violation check catches that on the pages it visits.
- Third-party scripts, inline `<script>` tags and `next/script` need the nonce from the request's
  `Content-Security-Policy` header. None exist today.
- A 404 under an excluded prefix (`/api/nope`) or a case variant of one (`/API/x`, which the
  case-sensitive matcher misses and `headers()` matches) renders Next's not-found page with the
  static policy only, or with both. That is what every path had before, and such pages reflect
  no input.
- Router prefetches (RSC payloads) and the trailing-slash redirects of excluded paths carry no
  CSP. Neither is a document, and `X-Frame-Options: DENY` stays on both.
- There is no `report-uri` in production. An endpoint would need rate limiting and would store
  page URLs, some of which carry an email in the query.
