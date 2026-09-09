import { betterAuth } from "better-auth";

import { getDb } from "@/db/client";

import { buildAuthOptions } from "./options";

type AuthOptions = ReturnType<typeof buildAuthOptions>;
type Auth = ReturnType<typeof betterAuth<AuthOptions>>;

let cachedAuth: Auth | undefined;

export function getAuth(): Auth {
  cachedAuth ??= betterAuth<AuthOptions>(buildAuthOptions(getDb()));
  return cachedAuth;
}
