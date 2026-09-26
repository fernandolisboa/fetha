export interface AccessContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const USER_AGENT_MAX_LENGTH = 512;

// Vercel appends the client address as the first `x-forwarded-for` hop and
// overwrites any value the client sent, so the first entry is the caller.
export function readAccessContext(headers: Headers): AccessContext {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwardedFor || headers.get("x-real-ip")?.trim() || null;
  const userAgent = headers.get("user-agent")?.trim().slice(0, USER_AGENT_MAX_LENGTH) || null;
  return { ipAddress, userAgent };
}
