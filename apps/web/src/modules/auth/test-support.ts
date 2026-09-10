// Integration-test helper only: Better Auth's rate limiter keys by client IP
// (better-auth's getIP falls back to a single shared "127.0.0.1" bucket per
// path when no `x-forwarded-for` header is present, which is exactly what a
// plain `new Request()`/`new Headers()` in a test gives it), so every test
// that exercises signIn/signUp/etc. through the handler needs its own IP to
// avoid tripping another test's rate limit (docs/adr/0016).
export function uniqueTestIp(): string {
  const octet = (): string => String(Math.floor(Math.random() * 255) + 1);
  return `10.${octet()}.${octet()}.${octet()}`;
}

export function testRequestHeaders(ip: string = uniqueTestIp()): Headers {
  return new Headers({ "x-forwarded-for": ip });
}
