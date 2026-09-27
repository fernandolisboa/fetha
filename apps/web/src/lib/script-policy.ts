// Report-only until a walk over every flow shows no violation (#125,
// docs/adr/0026). Next reads the nonce from this request header too and
// stamps it on its own inline bootstrap and chunk scripts.
export const SCRIPT_POLICY_HEADER = "Content-Security-Policy-Report-Only";

export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

// 'strict-dynamic' lets the nonced scripts load Next's chunks and makes
// browsers ignore 'self' for scripts, which is why the service worker needs
// its own worker-src. React's development build evaluates strings, hence
// 'unsafe-eval' in development only.
export function scriptPolicy(nonce: string, development: boolean): string {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}
