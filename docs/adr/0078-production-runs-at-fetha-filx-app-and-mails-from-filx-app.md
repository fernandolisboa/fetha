---
status: accepted
date: 2026-11-05
---

# Production runs at fetha.filx.app and sends mail from filx.app

## Context

Production was served at `fetha.vercel.app` and sent mail from `fetha@miolos.app` through Resend.
The owner moved Fetha to their own domain `filx.app`, whose DNS is hosted by Vercel in the same
team as the project. In production Better Auth trusts exactly one origin, `BETTER_AUTH_URL`
(`apps/web/src/modules/auth/options.ts`), so two live origins would mean two cookie jars and a
second trusted origin in code.

## Decision

- **One origin.** Production is `https://fetha.filx.app`: a project domain on Vercel and the
  value of `BETTER_AUTH_URL` (Production). Base URL, trusted origin, magic links and e-mail links
  all follow `BETTER_AUTH_URL`, so they move with it.
- **The old host redirects in the app, not in Vercel Domains.** `next.config.ts` answers every
  request to `fetha.vercel.app` with a 308 to the same path and query on `fetha.filx.app`
  (`src/lib/production-host.ts`), except `/api/cron`. Vercel Cron calls the production
  deployment, possibly on that host, and does not follow redirects: a redirected invocation ends
  before the handler runs, is not logged and is not retried. A domain-level redirect cannot
  exclude a path, so it would risk silently stopping the nightly ingestion.
- **Mail from filx.app.** `EMAIL_FROM` (Production) is `Fetha <fetha@filx.app>`. The domain is
  verified in Resend with its default records on the `send` subdomain (MX and SPF for the
  return path) plus the `resend._domainkey` DKIM key, so the apex SPF stays free for whatever
  mailbox provider receives `@filx.app` mail. The Resend API key stays, unless it was restricted to
  the old domain.
- **Privacy contact unchanged.** The data-request contact stays `fetha@miolos.app`, which has a
  mailbox; `filx.app` has none yet. Moving it changes the privacy policy, so it ships with a new
  terms version.

## Consequences

- Sessions and the installed PWA belong to the old origin: every user signs in again once at the
  new address, and the PWA is reinstalled from it.
- `*.vercel.app` is on the Public Suffix List; `filx.app` is not, so other apps under
  `*.filx.app` are same-site to Fetha. They are all the owner's. The cookie-authenticated GET
  routes refuse anything but `Sec-Fetch-Site: same-origin` or `none`, and the auth endpoints
  check the exact origin, so a sibling subdomain gets no more than a third-party site.
- Preview deployments keep their `*.vercel.app` hosts and `VERCEL_URL`; the redirect matches the
  legacy production host exactly.
- `BETTER_AUTH_URL` must point at the new origin before a deployment with the redirect goes live,
  or the redirect lands users on an origin auth does not trust.
