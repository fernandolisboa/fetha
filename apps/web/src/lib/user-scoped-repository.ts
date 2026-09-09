import type { Database } from "@/db/client";
import type { CurrentUser } from "@/modules/auth/session";

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

  // requireUser is imported lazily: session.ts pulls in the full better-auth
  // options chain, and options.ts wires repositories (e.g.
  // TermsAcceptanceRepository) whose `extends UserScopedRepository` clause
  // needs this module already fully evaluated. An eager import here would
  // make that a circular class-initialization error whenever this module is
  // the first one loaded.
  static async forCurrentUser<T extends UserScopedRepository>(
    this: new (db: Database, user: CurrentUser) => T,
    db: Database,
  ): Promise<T> {
    const { requireUser } = await import("@/modules/auth/session");
    const user = await requireUser();
    return new this(db, user);
  }
}
