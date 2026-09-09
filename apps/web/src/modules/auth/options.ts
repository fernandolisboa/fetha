import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { z } from "zod";

import type { Database } from "@/db/client";
import { registrationMode } from "@/lib/env";

import { buildVerificationEmail } from "./email/verification-email";
import { getMailer } from "./email/select";
import type { Mailer } from "./email/mailer";
import { isProductionDeployment, readAuthBaseUrl, type AuthEnv } from "./env";
import { consumePendingInvite, hasPendingInvite } from "./invite-repository";
import { normalizeEmail } from "./normalize-email";
import { evaluateRegistrationMode } from "./registration-policy";
import { recordTermsAcceptanceHistory } from "./terms-consent";
import { CURRENT_TERMS_VERSION } from "./terms";

const VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;

const signUpEmailBodySchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.email()).optional(),
  termsAccepted: z.boolean().optional(),
});

function readSignUpEmailBody(body: unknown): { email?: string; termsAccepted: boolean } {
  const parsed = signUpEmailBodySchema.safeParse(body);
  if (!parsed.success) {
    return { termsAccepted: false };
  }
  return {
    email: parsed.data.email,
    termsAccepted: parsed.data.termsAccepted === true,
  };
}

// Terms acceptance is atomic with the user INSERT: this data is merged into
// the same create statement Better Auth issues, so a user row can never
// exist with a null termsVersion (docs/adr/0016).
export function buildUserCreateOverrides(
  user: { email: string },
  termsAcceptedAt: Date = new Date(),
): { termsVersion: string; termsAcceptedAt: Date; email: string } {
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt,
    email: normalizeEmail(user.email),
  };
}

export function buildAuthOptions(
  db: Database,
  env: AuthEnv = process.env,
  mailer: Mailer = getMailer(env),
) {
  const baseURL = readAuthBaseUrl(env);

  return {
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: (request) => {
      if (isProductionDeployment(env) || !request) {
        return [baseURL];
      }
      return [baseURL, new URL(request.url).origin];
    },
    user: {
      additionalFields: {
        // required: false here means "the client request body does not need
        // to carry it"; the value is always supplied by
        // databaseHooks.user.create.before, so the database column itself
        // stays NOT NULL (docs/adr/0016) regardless of this flag.
        termsVersion: {
          type: "string",
          required: false,
          input: false,
        },
        termsAcceptedAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
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
        await mailer.send({ to: user.email, ...email });
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: (user: { email: string }) => {
            return Promise.resolve({ data: buildUserCreateOverrides(user) });
          },
          after: async (createdUser) => {
            const termsAcceptedAt = createdUser.termsAcceptedAt;
            await recordTermsAcceptanceHistory(db, {
              id: createdUser.id,
              name: createdUser.name,
              email: createdUser.email,
              termsAcceptedAt: termsAcceptedAt instanceof Date ? termsAcceptedAt : new Date(),
            });
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

        const { email, termsAccepted } = readSignUpEmailBody(ctx.body);

        if (!termsAccepted) {
          throw new APIError("BAD_REQUEST", { message: "terms_not_accepted" });
        }

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
