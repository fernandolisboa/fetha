import { NextResponse, type NextRequest } from "next/server";

import { newNonce, scriptPolicy, SCRIPT_POLICY_HEADER } from "@/lib/script-policy";

export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = scriptPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(SCRIPT_POLICY_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(SCRIPT_POLICY_HEADER, policy);
  return response;
}

// Pages only: API responses, build assets, the service worker, the offline
// fallback and icons carry no inline script, and prefetches are never
// rendered as a document.
export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|sw.js|offline.html|icons|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
