import { betterAuth } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";

import { getDb } from "@/db/client";

import { buildAuthOptions } from "./options";

type AuthOptions = ReturnType<typeof buildAuthOptions>;
type Auth = ReturnType<typeof betterAuth<AuthOptions>>;

let cachedAuth: Auth | undefined;

export function getAuth(): Auth {
  cachedAuth ??= betterAuth<AuthOptions>(buildAuthOptions(getDb()));
  return cachedAuth;
}

// The only Next.js Route Handler in the module; app/api/auth/[...all]/route.ts
// imports this instead of reaching into auth.ts directly, so
// src/modules/auth's index stays the module's sole entry point.
export const authRouteHandlers = toNextJsHandler((request: Request) => getAuth().handler(request));
