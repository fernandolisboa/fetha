import { sql } from "drizzle-orm";

import type { Database, Transaction } from "@/db/client";

// Every user-scoped repository extends this. The user is bound once, at
// construction, from the session; no method on a subclass may accept a user
// id as a parameter (CLAUDE.md, principle 5). Binding a repository to the
// live session is `modules/auth/session.ts`'s `forCurrentUser`, not a
// static method here, so this module takes only the shape it needs from the
// session user rather than importing `modules/auth` (lib must not depend on
// modules).
export interface ScopedUser {
  id: string;
}

export abstract class UserScopedRepository {
  constructor(
    protected readonly db: Database,
    protected readonly currentUser: ScopedUser,
  ) {}

  protected get userId(): string {
    return this.currentUser.id;
  }

  // Serializes a per-user count-then-insert cap check (docs/adr/0032):
  // without it two concurrent writes at cap-1 both pass. Held until `tx`
  // commits or rolls back.
  protected async lockUserScope(tx: Transaction, scope: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${this.userId}`}, 0))`,
    );
  }
}
