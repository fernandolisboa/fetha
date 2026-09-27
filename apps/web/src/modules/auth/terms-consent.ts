import type { Database } from "@/db/client";

import type { CurrentUser } from "./session";
import { CURRENT_TERMS_VERSION } from "./terms";
import { readTermsGate } from "./terms-gate";
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
  // Only read in the "unconfirmed" gate state: the name confirmation the
  // mailbox owner completes alongside their first real acceptance
  // (docs/adr/0036). Ignored in the "stale" state, where the name on file
  // is already the owner's own.
  name?: string;
}

export type AcceptTermsOutcome =
  | { status: "ok" }
  | { status: "already_current" }
  | { status: "name_required" }
  | { status: "unauthenticated" };

// The name-required rule lives here, decided against the database-read gate
// state, never against a client-supplied flag: the caller (the Server
// Action) only ever sees this outcome, never a raw terms_version.
export async function acceptTerms(
  db: Database,
  currentUser: CurrentUser,
  input: AcceptTermsInput = {},
): Promise<AcceptTermsOutcome> {
  const gate = await readTermsGate(db, currentUser);
  if (gate.state === "current") {
    return { status: "already_current" };
  }
  if (gate.state === "unconfirmed" && !input.name) {
    return { status: "name_required" };
  }

  const outcome = await new TermsAcceptanceRepository(db, currentUser).acceptCurrent({
    name: gate.state === "unconfirmed" ? input.name : undefined,
  });

  switch (outcome) {
    case "accepted":
      return { status: "ok" };
    case "already_current":
      return { status: "already_current" };
    case "user_not_found":
      return { status: "unauthenticated" };
  }
}
