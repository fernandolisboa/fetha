import { desc, eq, sql } from "drizzle-orm";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { termsAcceptances, user } from "./schema";
import { CURRENT_TERMS_VERSION } from "./terms";

export interface TermsAcceptance {
  id: string;
  termsVersion: string;
  acceptedAt: Date;
}

// "accepted": the user row and the history row were both written.
// "already_current": nothing was written; a concurrent accept (or the
// caller's own double submit) already brought the user to the current
// version.
// "user_not_found": nothing was written; the account no longer exists.
export type AcceptCurrentOutcome = "accepted" | "already_current" | "user_not_found";

export class TermsAcceptanceRepository extends UserScopedRepository {
  // Insert-only, best-effort append (docs/adr/0016): used by the sign-up
  // create hook, whose consent of record (`user.termsVersion`) is already
  // durable by the time this runs. The re-acceptance gate does not call
  // this: it needs the user UPDATE and the history INSERT to succeed or
  // fail together, which `acceptCurrent` below owns end to end.
  async record(termsVersion: string, acceptedAt: Date = new Date()): Promise<void> {
    await this.db.insert(termsAcceptances).values({
      userId: this.userId,
      termsVersion,
      acceptedAt,
    });
  }

  // The whole accept is one statement plus one insert, in one transaction,
  // never a public method a caller could split across two round trips
  // (docs/adr/0036): `WHERE terms_version IS DISTINCT FROM $current` makes
  // the UPDATE itself the concurrency check (NULL and a stale string both
  // qualify, `<>` would not treat NULL correctly), so a double submit or a
  // race with another accept writes the history row at most once.
  async acceptCurrent({ name }: { name?: string } = {}): Promise<AcceptCurrentOutcome> {
    return this.db.transaction(async (tx) => {
      const acceptedAt = new Date();
      const updated = await tx
        .update(user)
        .set({
          termsVersion: CURRENT_TERMS_VERSION,
          termsAcceptedAt: acceptedAt,
          ...(name ? { name } : {}),
        })
        .where(
          sql`${user.id} = ${this.userId} and ${user.termsVersion} is distinct from ${CURRENT_TERMS_VERSION}`,
        )
        .returning({ id: user.id });

      if (updated.length === 0) {
        const [existing] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, this.userId));
        return existing ? "already_current" : "user_not_found";
      }

      await tx.insert(termsAcceptances).values({
        userId: this.userId,
        termsVersion: CURRENT_TERMS_VERSION,
        acceptedAt,
      });
      return "accepted";
    });
  }

  async findLatest(): Promise<TermsAcceptance | undefined> {
    const [row] = await this.db
      .select({
        id: termsAcceptances.id,
        termsVersion: termsAcceptances.termsVersion,
        acceptedAt: termsAcceptances.acceptedAt,
      })
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, this.userId))
      .orderBy(desc(termsAcceptances.acceptedAt))
      .limit(1);
    return row;
  }
}
