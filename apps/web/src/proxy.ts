import { NextResponse, type NextRequest } from "next/server";

import { documentPolicy, newNonce } from "@/lib/document-policy";

const POLICY_HEADER = "Content-Security-Policy";

// Next stamps the nonce it reads from the request's policy on its own
// scripts, so the forwarded request carries the same policy the browser
// gets, replacing any a client sent.
export function proxy(request: NextRequest): NextResponse {
  const policy = documentPolicy(newNonce(), process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(POLICY_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(POLICY_HEADER, policy);
  return response;
}

// Documents only; next.config.ts sends the static policy on everything else
// (nonDocumentSources in lib/security-headers.ts). The router's own prefetches
// fetch RSC payloads, never a document. Excluded names match whole path
// segments so a page like /api-docs still gets the policy.
export const config = {
  matcher: [
    {
      source:
        "/((?!(?:api|_next|icons)(?:/|$)|(?:favicon\\.ico|sw\\.js|offline\\.html|manifest\\.webmanifest)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
