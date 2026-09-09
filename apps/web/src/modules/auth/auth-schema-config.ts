import { betterAuth } from "better-auth";

import { getDb } from "@/db/client";

import { buildAuthOptions } from "./options";

// Used only by `pnpm db:auth-schema` (the Better Auth CLI) to generate
// src/db/schema/auth.ts; never imported by application code, which goes
// through `getAuth()` in `auth.ts` instead.
export const auth = betterAuth(buildAuthOptions(getDb()));
