import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

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
