import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import type { Database } from "@/db/client";
import { registrationMode } from "@/lib/env";

import { buildVerificationEmail } from "./email/verification-email";
import { getMailer } from "./email/select";
import { readAuthBaseUrl, type AuthEnv } from "./env";
import { consumePendingInvite, hasPendingInvite } from "./invite-repository";
import { evaluateRegistrationMode } from "./registration-policy";
import { TermsAcceptanceRepository } from "./terms-acceptance-repository";
import { CURRENT_TERMS_VERSION } from "./terms";

const VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;

function readTermsAccepted(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  return (body as Record<string, unknown>).termsAccepted === true;
}

function readEmail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const value = (body as Record<string, unknown>).email;
  return typeof value === "string" ? value : undefined;
}

export function buildAuthOptions(db: Database, env: AuthEnv = process.env) {
  const baseURL = readAuthBaseUrl(env);

  return {
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_EXPIRES_IN_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        const email = buildVerificationEmail(user.name, url);
        await getMailer(env).send({ to: user.email, ...email });
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            await new TermsAcceptanceRepository(db, createdUser.id).record(CURRENT_TERMS_VERSION);
            await consumePendingInvite(db, createdUser.email, createdUser.id);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") {
          return;
        }

        if (!readTermsAccepted(ctx.body)) {
          throw new APIError("BAD_REQUEST", { message: "terms_not_accepted" });
        }

        const email = readEmail(ctx.body);
        const mode = registrationMode();
        const pendingInvite =
          mode === "invite" && email ? await hasPendingInvite(db, email) : false;
        const decision = evaluateRegistrationMode(mode, pendingInvite);
        if (!decision.allowed) {
          throw new APIError("FORBIDDEN", { message: decision.reason });
        }
      }),
    },
    plugins: [nextCookies()],
  } satisfies BetterAuthOptions;
}
