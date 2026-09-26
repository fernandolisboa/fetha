import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
