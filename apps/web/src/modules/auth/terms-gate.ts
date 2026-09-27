import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";

import { user } from "./schema";
import type { CurrentUser } from "./session";
import { CURRENT_TERMS_VERSION } from "./terms";

// The one entry point the shell layout and /aceitar-termos read: every other
// module compares against this classification, never against a raw
// `terms_version` string (docs/adr/0036). `"unconfirmed"` is a NULL
// `terms_version` (a verified account whose owner has not accepted yet);
// `"stale"` is an older, non-null version; `"current"` needs no gate.
export type TermsGateState = { state: "current" } | { state: "stale" } | { state: "unconfirmed" };

// Exported only for the pure branching test below; every real caller goes
// through `readTermsGate`.
export function classifyTermsVersion(termsVersion: string | null): TermsGateState {
  if (termsVersion === null) {
    return { state: "unconfirmed" };
  }
  if (termsVersion === CURRENT_TERMS_VERSION) {
    return { state: "current" };
  }
  return { state: "stale" };
}

// Read like `hasPassword`: from the database per request, never from the
// session cookie, since the cookie is minted once at sign-in and does not
// track a mid-session terms change.
export async function readTermsGate(
  db: Database,
  currentUser: CurrentUser,
): Promise<TermsGateState> {
  const [row] = await db
    .select({ termsVersion: user.termsVersion })
    .from(user)
    .where(eq(user.id, currentUser.id))
    .limit(1);
  return classifyTermsVersion(row?.termsVersion ?? null);
}
