import { desc, eq } from "drizzle-orm";

import { termsAcceptances } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface TermsAcceptance {
  id: string;
  termsVersion: string;
  acceptedAt: Date;
}

export class TermsAcceptanceRepository extends UserScopedRepository {
  async record(termsVersion: string, acceptedAt: Date = new Date()): Promise<void> {
    await this.db.insert(termsAcceptances).values({
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
