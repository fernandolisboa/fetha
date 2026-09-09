import type { Database } from "@/db/client";

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
}
