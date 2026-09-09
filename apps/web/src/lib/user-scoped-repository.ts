import type { Database } from "@/db/client";

// Every user-scoped repository extends this. The user id is bound once, at
// construction, from the session; no method on a subclass may accept a user
// id as a parameter (CLAUDE.md, principle 5).
export abstract class UserScopedRepository {
  constructor(
    protected readonly db: Database,
    protected readonly userId: string,
  ) {}
}
