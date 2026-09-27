import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";

import { user } from "./schema";
import type { CurrentUser } from "./session";
import { CURRENT_TERMS_VERSION } from "./terms";

// `terms_version` is NULL on a verified account whose owner has not
// accepted yet (docs/adr/0036) and otherwise carries the version last
// accepted, which may be older than the current one after a terms change.
export function isCurrentTermsVersion(termsVersion: string | null): boolean {
  return termsVersion === CURRENT_TERMS_VERSION;
}

// Read like `hasPassword`: from the database per request, never from the
// session cookie, since the cookie is minted once at sign-in and does not
// track a mid-session terms change.
export async function readTermsVersion(
  db: Database,
  currentUser: CurrentUser,
): Promise<string | null> {
  const [row] = await db
    .select({ termsVersion: user.termsVersion })
    .from(user)
    .where(eq(user.id, currentUser.id))
    .limit(1);
  return row?.termsVersion ?? null;
}

export async function needsTermsReacceptance(
  db: Database,
  currentUser: CurrentUser,
): Promise<boolean> {
  return !isCurrentTermsVersion(await readTermsVersion(db, currentUser));
}
