---
status: accepted
date: 2026-09-26
---

# HTTP security headers on every response; a script-src CSP waits for nonces

## Context

The app sent no security headers (security audit A-02, #42): `/entrar` and `/cadastro` could be
framed by another site for clickjacking, a future XSS would have had no second line of defence,
and URLs carrying an email in the query (`/verificar-email?email=…`) could leak through `Referer`.
Feudo has no header setup to copy. Next.js emits inline bootstrap scripts
(`self.__next_f.push(…)`), so a `script-src` without `'unsafe-inline'` needs a per-request nonce
set in `proxy.ts`, which Next then applies to its own scripts. Every page is already dynamic (the
root layout reads the session), so nonces cost no static rendering, but they touch every page
and need a pass over `lightweight-charts`, visx and the service worker.

## Decision

1. `apps/web/next.config.ts` sends `securityHeaders` (`apps/web/src/lib/security-headers.ts`) on
   every path:
   - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self';
object-src 'none'`
   - `X-Frame-Options: DENY`, for browsers that predate `frame-ancestors`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
2. The CSP leaves `default-src`, `script-src` and `style-src` unset. Those directives are what
   Next's inline scripts would violate; the four above are enforced now because nothing in the
   app frames itself, posts forms off-origin, sets `<base>` or embeds plugins. Checked on a
   production build: no CSP console errors on the auth pages or on a server-action submit. On
   the Vercel preview every response type carries the headers (pages, redirects, `sw.js`, fonts).
3. A nonce-based `script-src 'self' 'nonce-…' 'strict-dynamic'` is the next step (#125),
   introduced report-only first and enforced once a preview shows no violations.

## Consequences

- Fetha cannot be embedded in an `<iframe>` anywhere, including by the owner.
- Links to other sites send only the origin in `Referer`, never a path or query.
- XSS is still mitigated only by React's escaping until the nonce CSP ships.
