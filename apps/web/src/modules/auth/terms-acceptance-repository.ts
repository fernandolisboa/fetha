import { desc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { termsAcceptances } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface TermsAcceptance {
  id: string;
  termsVersion: string;
  acceptedAt: Date;
}

type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export class TermsAcceptanceRepository extends UserScopedRepository {
  // `db` defaults to the instance's own connection; a caller that must write
  // this row in the same transaction as another statement (the re-acceptance
  // gate's user UPDATE, `terms-consent.ts`) passes the transaction handle
  // instead.
  async record(
    termsVersion: string,
    acceptedAt: Date = new Date(),
    db: DbOrTx = this.db,
  ): Promise<void> {
    await db.insert(termsAcceptances).values({
      userId: this.userId,
      termsVersion,
      acceptedAt,
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
