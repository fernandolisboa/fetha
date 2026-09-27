import { NextResponse, type NextRequest } from "next/server";

import { newNonce, scriptPolicy, SCRIPT_POLICY_HEADER } from "@/lib/script-policy";

export function proxy(request: NextRequest): NextResponse {
  const policy = scriptPolicy(newNonce(), process.env.NODE_ENV === "development");

  // Next takes the nonce it stamps from the request's Content-Security-Policy
  // before the report-only one, so a policy the client sent would choose it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("content-security-policy");
  requestHeaders.set(SCRIPT_POLICY_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(SCRIPT_POLICY_HEADER, policy);
  return response;
}

// Documents only: API responses, build assets, the service worker, the offline
// fallback and icons carry no inline script, and the router's own prefetches
// fetch RSC payloads, never a document. Excluded names match whole path
// segments so a page like /api-docs still gets the policy.
export const config = {
  matcher: [
    {
      source:
        "/((?!(?:api|_next/static|_next/image|icons)(?:/|$)|(?:favicon\\.ico|sw\\.js|offline\\.html|manifest\\.webmanifest)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
