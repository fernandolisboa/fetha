import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getAuth } from "./auth";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated session");
    this.name = "UnauthenticatedError";
  }
}

async function loadSession(): Promise<CurrentUser | null> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

// Cached per request (React.cache): the shell layout, the root layout and a
// page can each call getSession()/requireUser() without issuing a second
// session lookup.
export const getSession = cache(loadSession);

export const requireUser = cache(async (): Promise<CurrentUser> => {
  const user = await getSession();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
});

// The one place outside a Better Auth hook that binds a user-scoped
// repository to the live session (docs/adr/0016-auth-and-tenancy.md). No
// method on a repository built this way may accept a user id as a parameter.
export async function forCurrentUser<T extends UserScopedRepository>(
  db: Database,
  Repository: new (db: Database, user: CurrentUser) => T,
): Promise<T> {
  const user = await requireUser();
  return new Repository(db, user);
}

// Every Server Action that requires a session redirects an unauthenticated
// caller to sign-in instead of leaking an error (issue #71): this is the one
// place that translates `UnauthenticatedError` into that redirect, so no
// action module repeats the try/catch.
export async function withAuthenticatedAction<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
}
