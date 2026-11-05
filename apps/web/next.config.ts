import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

import { legacyHostRedirects } from "./src/lib/production-host";
import {
  nonDocumentSources,
  securityHeaders,
  staticContentSecurityPolicy,
} from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      ...nonDocumentSources.map((source) => ({ source, headers: [staticContentSecurityPolicy] })),
    ]);
  },
  redirects() {
    return Promise.resolve(legacyHostRedirects);
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
