import type { Database } from "@/db/client";
import type { CurrentUser } from "@/modules/auth/session";
import { requireUser } from "@/modules/auth/session";

// Every user-scoped repository extends this. The user is bound once, at
// construction, from the session; no method on a subclass may accept a user
// id as a parameter (CLAUDE.md, principle 5).
export abstract class UserScopedRepository {
  constructor(
    protected readonly db: Database,
    protected readonly currentUser: CurrentUser,
  ) {}

  protected get userId(): string {
    return this.currentUser.id;
  }

  static async forCurrentUser<T extends UserScopedRepository>(
    this: new (db: Database, user: CurrentUser) => T,
    db: Database,
  ): Promise<T> {
    const user = await requireUser();
    return new this(db, user);
  }
}
