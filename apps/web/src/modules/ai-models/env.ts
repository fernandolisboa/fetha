interface AiModelsEnv {
  BETTER_AUTH_SECRET?: string;
  [key: string]: string | undefined;
}

// `BETTER_AUTH_SECRET` is required in every real environment (the auth
// module's own `account-rate-limit.ts` makes the same assumption): an
// unset value here is a deployment misconfiguration the key encryption
// cannot key around, so it throws rather than silently using a weak
// default (docs/adr/0068).
export function readBetterAuthSecret(env: AiModelsEnv = process.env): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set");
  }
  return secret;
}
