// Directives that constrain framing, forms, <base> and plugins. Documents get
// them from the proxy together with the nonce script-src (docs/adr/0035);
// every other path gets them here.
export const BASE_CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

export const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

// The paths the proxy matcher (src/proxy.ts) excludes by name. A document
// must not also get this header: Next reads the nonce from the request's
// Content-Security-Policy, and on Vercel a static one reaches the render.
// Router prefetches, which the proxy also skips, get neither policy.
export const nonDocumentSources = [
  "/api/:path*",
  "/_next/:path*",
  "/icons/:path*",
  "/:file(favicon\\.ico|sw\\.js|offline\\.html|manifest\\.webmanifest)",
];

export const staticContentSecurityPolicy = {
  key: "Content-Security-Policy",
  value: BASE_CONTENT_SECURITY_POLICY.join("; "),
};
