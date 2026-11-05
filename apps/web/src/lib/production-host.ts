import type { NextConfig } from "next";

type Redirects = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>;

const PRODUCTION_ORIGIN = "https://fetha.filx.app";

const LEGACY_PRODUCTION_HOST = "fetha.vercel.app";

// Vercel Cron calls the production deployment and does not follow redirects
// (vercel.com/docs/cron-jobs/manage-cron-jobs), so /api/cron stays served on
// the legacy host; everything else moves to the one origin auth trusts
// (docs/adr/0078).
export const legacyHostRedirects: Redirects = [
  {
    source: "/:path((?!api/cron(?:/|$)).*)",
    has: [{ type: "host", value: LEGACY_PRODUCTION_HOST }],
    destination: `${PRODUCTION_ORIGIN}/:path`,
    permanent: true,
  },
];
