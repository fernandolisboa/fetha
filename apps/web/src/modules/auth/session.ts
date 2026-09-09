import { headers } from "next/headers";

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

export async function getSession(): Promise<CurrentUser | null> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getSession();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}
