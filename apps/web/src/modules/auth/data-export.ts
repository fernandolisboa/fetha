import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { account, session, termsAcceptances, user } from "./schema";

// Password hashes, session tokens and OAuth tokens never leave (docs/adr/0027).
export class AuthDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [profile, sessions, accounts, acceptances] = await Promise.all([
      this.db.select().from(user).where(eq(user.id, this.userId)),
      this.db
        .select({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        })
        .from(session)
        .where(eq(session.userId, this.userId)),
      this.db
        .select({
          id: account.id,
          providerId: account.providerId,
          accountId: account.accountId,
          scope: account.scope,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .from(account)
        .where(eq(account.userId, this.userId)),
      this.db.select().from(termsAcceptances).where(eq(termsAcceptances.userId, this.userId)),
    ]);
    return {
      user: profile,
      session: sessions,
      account: accounts,
      terms_acceptances: acceptances,
    };
  }
}
