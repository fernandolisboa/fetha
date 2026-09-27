import { headers } from "next/headers";

import type { AuthEnv } from "./env";

import { getAuth } from "./auth";
import { readOwnerEmails } from "./env";

export interface OwnerCandidate {
  email: string;
  emailVerified: boolean;
}

// Pure so the allowlist and the verified-email requirement are unit
// testable without a session; `isOwner` below is the server-only entry that
// feeds it the signed-in session (#51: never an id or email the client
// supplies).
export function isOwnerEmail(
  candidate: OwnerCandidate | null,
  env: AuthEnv = process.env,
): boolean {
  if (!candidate || !candidate.emailVerified) {
    return false;
  }
  const ownerEmails = readOwnerEmails(env);
  return ownerEmails.has(candidate.email.trim().toLowerCase());
}

// The one place a manual trigger may check "is this the owner" (#51): reads
// the session from the server's own request headers, never from a client-
// supplied id, and requires the account's email to be verified.
export async function isOwner(): Promise<boolean> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return false;
  }
  return isOwnerEmail({
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  });
}
