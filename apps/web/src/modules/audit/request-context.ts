import { isIP } from "node:net";

export interface AccessContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const USER_AGENT_MAX_LENGTH = 512;

// Same header order as Better Auth's session IP (auth/options.ts), so the
// access log and the session agree. Vercel sets both headers itself; a value
// that is not an address is stored as null.
export function readAccessContext(headers: Headers): AccessContext {
  const candidate =
    headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = candidate && isIP(candidate) !== 0 ? candidate : null;
  const userAgent = headers.get("user-agent")?.trim().slice(0, USER_AGENT_MAX_LENGTH) || null;
  return { ipAddress, userAgent };
}
