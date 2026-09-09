import type { Database } from "@/db/client";

import { CURRENT_TERMS_VERSION } from "./terms";
import { TermsAcceptanceRepository } from "./terms-acceptance-repository";

export interface CreatedUserConsent {
  id: string;
  name: string;
  email: string;
  termsAcceptedAt: Date;
}

// The consent itself is already durable: `termsVersion` and
// `termsAcceptedAt` are additional fields on the `user` row, set in the same
// INSERT by `databaseHooks.user.create.before`. This history row is
// best-effort and append-only (docs/adr/0016); a transient failure here must
// never undo or fail the registration that already happened.
export async function recordTermsAcceptanceHistory(
  db: Database,
  createdUser: CreatedUserConsent,
): Promise<void> {
  try {
    await new TermsAcceptanceRepository(db, createdUser).record(
      CURRENT_TERMS_VERSION,
      createdUser.termsAcceptedAt,
    );
  } catch (error) {
    console.error(
      "failed to record terms acceptance history",
      error instanceof Error ? error.name : "Unknown",
    );
  }
}
