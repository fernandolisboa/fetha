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

1. Every document gets exactly one policy, set by `apps/web/src/proxy.ts` on both the forwarded
   request and the response, with a fresh 128-bit nonce per request
   (`apps/web/src/lib/script-policy.ts`):
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
5. The report-only trial is replaced by a walk before merge. The whole Playwright suite ran
   against a local production build of this policy, with a `report-uri` added only for that
   run and pointed at a local collector. It covered the signed-in flows: charts, the strategy
   editor, backtests, the B3 import, dialogs and the service worker. The collector received
   no report. `e2e/security-headers.spec.ts` keeps a check that fails
   on any `securitypolicyviolation` on the public pages, and it runs against the preview too.

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
- There is no `report-uri` in production. An endpoint would need rate limiting and would store
  page URLs, some of which carry an email in the query.
