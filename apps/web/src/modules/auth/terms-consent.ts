import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";

import { user } from "./schema";
import type { CurrentUser } from "./session";
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

export interface AcceptTermsInput {
  // Only set when the gate is asking for a first acceptance (`terms_version`
  // was NULL): the name confirmation the mailbox owner completes alongside
  // it (docs/adr/0036).
  name?: string;
}

// Unlike registration, this consent's history row must be durable: it is the
// whole point of the re-acceptance gate, so both writes happen in one
// transaction rather than the best-effort append `recordTermsAcceptanceHistory`
// uses at sign-up.
export async function acceptTerms(
  db: Database,
  currentUser: CurrentUser,
  input: AcceptTermsInput = {},
): Promise<void> {
  const acceptedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        termsVersion: CURRENT_TERMS_VERSION,
        termsAcceptedAt: acceptedAt,
        ...(input.name ? { name: input.name } : {}),
      })
      .where(eq(user.id, currentUser.id));
    await new TermsAcceptanceRepository(db, currentUser).record(
      CURRENT_TERMS_VERSION,
      acceptedAt,
      tx,
    );
  });
}
