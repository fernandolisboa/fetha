import type { BetterAuthOptions } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  sendVerificationEmailFn,
} from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { z } from "zod";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { user } from "./schema";
import { createRuntimeSettings, type RuntimeSettings } from "@/lib/runtime-settings";

import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  refundAccountAttempt,
  type AccountRateLimitRule,
} from "./account-rate-limit";
import { buildMagicLinkEmail } from "./email/magic-link-email";
import { buildPasswordResetEmail } from "./email/password-reset-email";
import { buildVerificationEmail } from "./email/verification-email";
import { getMailer } from "./email/select";
import { deleteOperationalRowsOf } from "./account-deletion";
import type { Mailer } from "./email/mailer";
import { isProductionDeployment, readAuthBaseUrl, type AuthEnv } from "./env";
import { consumePendingInviteSafely, hasPendingInvite } from "./invite-repository";
import { normalizeEmail } from "./normalize-email";
import { evaluateRegistrationMode } from "./registration-policy";
import { resolveRegistrationMode } from "./registration-mode";
import { recordTermsAcceptanceHistory } from "./terms-consent";
import { CURRENT_TERMS_VERSION } from "./terms";
import { markEmailVerified, revokeUnprovenAccountAccess } from "./unverified-accounts";
import { emailField, nameField } from "./validation";
import { SESSION_EXPIRES_IN_DAYS } from "./session-lifetime";

const VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;
const MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 5;
const PASSWORD_RESET_EXPIRES_IN_SECONDS = 60 * 60;
// Better Auth's own default, pinned because the privacy policy states it.
const SESSION_EXPIRES_IN_SECONDS = SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60;

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
  "/delete-user": { window: 60, max: 3 },
};

// The rules above are IP-and-path only (Better Auth has no per-account
// dimension built in); the A-01 remediation also requires per-account limits
// so a distributed attacker rotating IPs against one email cannot bypass the
// IP bucket (docs/security-audit/2026-09-09.md, docs/adr/0016). Same windows
// as the IP-based rules for the paths that have one; `/sign-in/magic-link`
// gets the same shape as `/request-password-reset` since it has no built-in
// special rule either. Every account window here must stay at or below Better
// Auth's longest configured window (currently 60s) or its background prune
// could delete a live account bucket (better-auth/dist/api/rate-limiter/index.mjs
// `deleteExpiredRows`).
const ACCOUNT_RATE_LIMIT_RULES: Record<string, AccountRateLimitRule> = {
  "/sign-in/email": { windowSeconds: 10, max: 3 },
  "/sign-up/email": { windowSeconds: 60, max: 3 },
  "/sign-in/magic-link": { windowSeconds: 60, max: 3 },
  "/request-password-reset": { windowSeconds: 60, max: 3 },
  "/send-verification-email": { windowSeconds: 60, max: 3 },
};

const accountRateLimitedBodySchema = z.object({
  email: emailField.optional(),
});

function readAccountRateLimitEmail(body: unknown): string | undefined {
  const parsed = accountRateLimitedBodySchema.safeParse(body);
  return parsed.success ? parsed.data.email : undefined;
}

// Better Auth stores the name exactly as posted, so a name that only passes
// once trimmed (edge line breaks) is refused rather than stored untrimmed.
const signUpNameSchema = z.object({
  name: z
    .string()
    .refine((name) => name === name.trim())
    .pipe(nameField),
});

// Deleting an account by emailed link is closed (docs/adr/0027). No screen
// changes or checks a password while signed in, and those two endpoints
// answer "wrong password" to whoever holds the session: a stolen cookie
// could test guesses from rotating IPs (#145, docs/adr/0034).
// `/verify-password` is marked server scope, yet Better Auth serves it over
// HTTP.
const CLOSED_PATHS: ReadonlySet<string> = new Set([
  "/delete-user/callback",
  "/change-password",
  "/verify-password",
]);

// Account deletion always takes the password (docs/adr/0027): Better Auth
// would otherwise also accept a fresh session alone, or an emailed token.
// Per signed-in account, next to the IP rule above: the endpoint answers
// "wrong password" to whoever holds the session, so it is bounded the way
// sign-in is (docs/adr/0027).
const DELETE_USER_ACCOUNT_RULE: AccountRateLimitRule = { windowSeconds: 60, max: 3 };

const deleteUserBodySchema = z.object({
  password: z.string().min(1),
  token: z.never().optional(),
});

const signUpEmailBodySchema = z.object({
  email: emailField.optional(),
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
  rateLimitEnabled = true,
  runtimeSettings: RuntimeSettings = createRuntimeSettings(env),
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
      deleteUser: {
        enabled: true,
        beforeDelete: async (deletedUser) => {
          await deleteOperationalRowsOf(db, deletedUser);
        },
      },
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
    session: { expiresIn: SESSION_EXPIRES_IN_SECONDS },
    // A database leak must not yield live reset or magic-link tokens (#60).
    verification: { storeIdentifier: "hashed" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN_SECONDS,
      // A session minted before a password reset must not survive it: without
      // this, a stolen session cookie keeps working even after the account
      // owner resets their password to lock an attacker out.
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user: resetUser }) => {
        await markEmailVerified(db, resetUser.id);
        await consumePendingInviteSafely(db, resetUser.email, resetUser.id);
      },
      sendResetPassword: async ({ user: resetUser, url }) => {
        const email = buildPasswordResetEmail(url);
        await mailer.send({ to: resetUser.email, ...email });
      },
    },
    // Email first (docs/adr/0028, #144): whatever password came with the
    // sign-up is unproven, so opening the link drops it and signs the
    // mailbox owner in to set their own. Better Auth only signs in on the
    // click that flips `emailVerified`; later clicks just redirect.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      beforeEmailVerification: async (verifyingUser) => {
        await revokeUnprovenAccountAccess(db, verifyingUser.id);
      },
      expiresIn: VERIFICATION_EXPIRES_IN_SECONDS,
      sendVerificationEmail: async ({ user: verifyingUser, url }) => {
        const email = buildVerificationEmail(url);
        await mailer.send({ to: verifyingUser.email, ...email });
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
          },
        },
        update: {
          // An invite is spent only by whoever proves they own its mailbox:
          // whoever merely registers an invited email first cannot burn it
          // (docs/adr/0029, #39).
          after: async (updated) => {
            // Typed non-null, but Better Auth passes the adapter's result, which is
            // null when the row was deleted in between (the purge, an account deletion).
            const updatedUser = updated as typeof updated | null;
            if (updatedUser?.emailVerified) {
              await consumePendingInviteSafely(db, updatedUser.email, updatedUser.id);
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const accountRule = ACCOUNT_RATE_LIMIT_RULES[ctx.path];
        if (accountRule) {
          const email = readAccountRateLimitEmail(ctx.body);
          if (email) {
            try {
              await enforceAccountRateLimit(db, email, ctx.path, accountRule);
            } catch (error) {
              if (error instanceof AccountRateLimitExceededError) {
                throw new APIError("TOO_MANY_REQUESTS", { message: "rate_limited" });
              }
              throw error;
            }
          }
        }

        if (CLOSED_PATHS.has(ctx.path)) {
          throw new APIError("NOT_FOUND");
        }
        if (ctx.path === "/delete-user") {
          if (!deleteUserBodySchema.safeParse(ctx.body).success) {
            throw new APIError("BAD_REQUEST", { message: "password_required" });
          }
          const session = await getSessionFromCtx(ctx);
          if (session) {
            try {
              await enforceAccountRateLimit(
                db,
                session.user.email,
                ctx.path,
                DELETE_USER_ACCOUNT_RULE,
              );
            } catch (error) {
              if (error instanceof AccountRateLimitExceededError) {
                throw new APIError("TOO_MANY_REQUESTS", { message: "rate_limited" });
              }
              throw error;
            }
          }
        }

        if (ctx.path !== "/sign-up/email") {
          return;
        }

        // The sign-up form validates the name too, but this endpoint is
        // reachable directly (#45).
        if (!signUpNameSchema.safeParse(ctx.body).success) {
          throw new APIError("BAD_REQUEST", { message: "invalid_name" });
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

        const mode = await resolveRegistrationMode(runtimeSettings, env);
        const pendingInvite =
          mode === "invite" && email ? await hasPendingInvite(db, email) : false;
        const decision = evaluateRegistrationMode(mode, pendingInvite);
        if (!decision.allowed) {
          throw new APIError("FORBIDDEN", { message: decision.reason });
        }

        // A second sign-up for a still-unverified email gets a fresh link, as
        // the first did; Better Auth then answers with its generic duplicate
        // response and sends nothing. The pending row is kept, never
        // replaced, so its id cannot change under a verification in flight
        // (docs/adr/0028).
        const pending = email
          ? await db.query.user.findFirst({ where: eq(user.email, email) })
          : undefined;
        if (pending && !pending.emailVerified) {
          await sendVerificationEmailFn(ctx, pending);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email" || !ctx.context.newSession) {
          return;
        }
        const email = readAccountRateLimitEmail(ctx.body);
        if (email) {
          await refundAccountAttempt(db, email, ctx.path);
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
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // Same `{ status: true }` whether or not the email has an account;
          // only an existing one receives mail. Both branches run the same
          // lookup, and the production mailer sends after the response
          // (docs/adr/0031), so the timing does not tell them apart either.
          const existingUser = await db.query.user.findFirst({
            where: eq(user.email, normalizeEmail(email)),
          });
          if (!existingUser) {
            return;
          }
          const content = buildMagicLinkEmail(url);
          await mailer.send({ to: email, ...content });
        },
      }),
      nextCookies(),
    ],
    // Vercel's edge network always sets `x-real-ip` to the actual client
    // address and `x-forwarded-for` to a single trusted value (no untrusted
    // proxy chain to walk), so both are safe to read directly; without this,
    // Better Auth's default falls back to a single shared bucket across every
    // client whose IP it cannot resolve (docs/adr/0016).
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-real-ip", "x-forwarded-for"],
      },
    },
    // Database-backed so the limit survives across Vercel's per-instance
    // serverless functions, unlike Better Auth's default in-memory Map
    // (docs/security-audit/2026-09-09.md A-01, docs/adr/0016). `rateLimitEnabled`
    // defaults to true; a unit test that needs it off injects `false`
    // explicitly instead of this module inferring it from the Vitest env.
    rateLimit: {
      enabled: rateLimitEnabled,
      storage: "database",
      customRules: RATE_LIMIT_CUSTOM_RULES,
    },
  } satisfies BetterAuthOptions;
}
