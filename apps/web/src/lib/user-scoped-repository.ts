import type { Database } from "@/db/client";
import type { CurrentUser } from "@/modules/auth/session";

// Every user-scoped repository extends this. The user is bound once, at
// construction, from the session; no method on a subclass may accept a user
// id as a parameter (CLAUDE.md, principle 5). Binding a repository to the
// live session is `modules/auth/session.ts`'s `forCurrentUser`, not a
// static method here, so this module never needs to import the session
// chain that constructs the user in the first place.
export abstract class UserScopedRepository {
  constructor(
    protected readonly db: Database,
    protected readonly currentUser: CurrentUser,
  ) {}

  protected get userId(): string {
    return this.currentUser.id;
  }
}
