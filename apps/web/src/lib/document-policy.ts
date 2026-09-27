import { BASE_CONTENT_SECURITY_POLICY } from "./security-headers";

export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

// 'strict-dynamic' lets the nonced scripts load Next's chunks and makes
// browsers ignore 'self' for scripts, which is why the service worker needs
// its own worker-src. React's development build evaluates strings, hence
// 'unsafe-eval' in development only.
export function documentPolicy(nonce: string, development: boolean): string {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self'",
    ...BASE_CONTENT_SECURITY_POLICY,
  ].join("; ");
}
