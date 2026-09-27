import type { AuthEnv } from "./env";

import { readOwnerEmails } from "./env";
import { getSession } from "./session";

export interface OwnerCandidate {
  email: string;
  emailVerified: boolean;
}

// Pure so the allowlist and the verified-email requirement are unit
// testable without a session; `isOwner` below is the server-only entry that
// feeds it the signed-in session (#51: never an id or email the client
// supplies). Not re-exported from the module's own `index.ts`: nothing
// outside `auth` needs it, only this file's own test.
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
// the per-request-cached session (`getSession`, never an id or email a
// client supplies) and requires the account's email to be verified.
export async function isOwner(): Promise<boolean> {
  const user = await getSession();
  return isOwnerEmail(user);
}
