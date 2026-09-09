import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { z } from "zod";

import type { Database } from "@/db/client";
import { registrationMode } from "@/lib/env";

import { buildMagicLinkEmail } from "./email/magic-link-email";
import { buildPasswordResetEmail } from "./email/password-reset-email";
import { buildVerificationEmail } from "./email/verification-email";
import { getMailer } from "./email/select";
import type { Mailer } from "./email/mailer";
import { isProductionDeployment, isUnitTestEnv, readAuthBaseUrl, type AuthEnv } from "./env";
import { consumePendingInviteSafely, hasPendingInvite } from "./invite-repository";
import { normalizeEmail } from "./normalize-email";
import { evaluateRegistrationMode } from "./registration-policy";
import { recordTermsAcceptanceHistory } from "./terms-consent";
import { CURRENT_TERMS_VERSION } from "./terms";

const VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;
const MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 5;
const PASSWORD_RESET_EXPIRES_IN_SECONDS = 60 * 60;

// Matches the security audit's A-01 remediation (docs/security-audit/2026-09-09.md):
// the same window/max values Better Auth's own in-memory defaults already
// used for sign-in and sign-up, made explicit here so they survive an
// upstream default change, now backed by the database store below instead
// of a per-instance in-memory Map. `/reset-password` (the token-plus-new-
// password submission) and `/sign-in/magic-link` have no built-in special
// rule of their own, so this is also where they get one.
const RATE_LIMIT_CUSTOM_RULES: NonNullable<BetterAuthOptions["rateLimit"]>["customRules"] = {
  "/sign-in/email": { window: 10, max: 3 },
  "/sign-up/email": { window: 10, max: 3 },
  "/request-password-reset": { window: 60, max: 3 },
  "/reset-password": { window: 60, max: 5 },
  "/send-verification-email": { window: 60, max: 3 },
};

const signUpEmailBodySchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.email()).optional(),
  termsAccepted: z.boolean().optional(),
  privacyAccepted: z.boolean().optional(),
});

function readSignUpEmailBody(body: unknown): {
  email?: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
} {
  const parsed = signUpEmailBodySchema.safeParse(body);
  if (!parsed.success) {
    return { termsAccepted: false, privacyAccepted: false };
  }
  return {
    email: parsed.data.email,
    termsAccepted: parsed.data.termsAccepted === true,
    privacyAccepted: parsed.data.privacyAccepted === true,
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
    // `transaction: true` wraps each Better Auth operation's writes (e.g.
    // sign-up's `user` INSERT plus its `account` INSERT) in one
    // `db.transaction()`, so a failure partway through can never leave an
    // orphan `user` row with no matching `account`.
    database: drizzleAdapter(db, { provider: "pg", transaction: true }),
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
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN_SECONDS,
      sendResetPassword: async ({ user, url }) => {
        const email = buildPasswordResetEmail(url);
        await mailer.send({ to: user.email, ...email });
      },
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
            await consumePendingInviteSafely(db, createdUser.email, createdUser.id);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") {
          return;
        }

        const { email, termsAccepted, privacyAccepted } = readSignUpEmailBody(ctx.body);

        if (!termsAccepted) {
          throw new APIError("BAD_REQUEST", { message: "terms_not_accepted" });
        }
        // ADR-0016 records terms and privacy acceptance as a single pair
        // (`termsVersion`/`termsAcceptedAt`, stamped together below): a
        // client that skips the privacy checkbox is refused here rather
        // than after being allowed to bypass the terms check alone.
        if (!privacyAccepted) {
          throw new APIError("BAD_REQUEST", { message: "privacy_not_accepted" });
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
    plugins: [
      // `disableSignUp: true`: a magic-link click that creates a brand new
      // user would bypass the terms/privacy checkboxes sign-up requires
      // (ADR-0016's consent invariant) and REGISTRATION_MODE's invite gate,
      // which only guards `/sign-up/email`. Magic link is sign-in only here.
      magicLink({
        disableSignUp: true,
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        rateLimit: { window: 60, max: 3 },
        sendMagicLink: async ({ email, url }) => {
          const content = buildMagicLinkEmail(url);
          await mailer.send({ to: email, ...content });
        },
      }),
      nextCookies(),
    ],
    // Database-backed so the limit survives across Vercel's per-instance
    // serverless functions, unlike Better Auth's default in-memory Map
    // (docs/security-audit/2026-09-09.md A-01, docs/adr/0016). Off only
    // under plain unit tests, which never migrate a real `rate_limits`
    // table (isUnitTestEnv, env.ts).
    rateLimit: {
      enabled: !isUnitTestEnv(env),
      storage: "database",
      customRules: RATE_LIMIT_CUSTOM_RULES,
    },
  } satisfies BetterAuthOptions;
}
