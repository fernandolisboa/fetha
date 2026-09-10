import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

// `/sign-up/email` is rate-limited to 3 per 10s per IP (options.ts,
// RATE_LIMIT_CUSTOM_RULES); every spec in playwright.config.ts's "auth"
// project runs from the same machine/IP, sequentially (fullyParallel: false,
// workers: 1), so a fixed gap ahead of every sign-up, rather than exempting
// the E2E client from the limit it exists to test, keeps the suite under the
// cap regardless of how many specs call it or in what order.
const SIGN_UP_SPACING_MS = 3500;
let earliestNextSignUpAt = 0;

export async function throttleSignUp(): Promise<void> {
  const now = Date.now();
  const waitMs = earliestNextSignUpAt - now;
  earliestNextSignUpAt = Math.max(now, earliestNextSignUpAt) + SIGN_UP_SPACING_MS;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// The one place that reads a captured link back from the E2E-only route
// (docs/adr/0016): registration, magic-link and password-reset specs all
// need this, so it lives here instead of three near-identical copies.
export async function readLatestLink(
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<string> {
  const linkResponse = await request.get(
    `${baseURL ?? ""}/api/e2e/verification-link?email=${encodeURIComponent(email)}`,
    { headers: { "x-e2e-secret": secret } },
  );
  expect(linkResponse.ok()).toBe(true);
  const { link } = (await linkResponse.json()) as { link: string };
  return link;
}
