import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// `/sign-up/email` is rate-limited to 3 per 10s per IP, and the window
// restarts from the *last allowed* request rather than the first
// (options.ts, RATE_LIMIT_CUSTOM_RULES; better-auth bumps `lastRequest` on
// every allowed call). Every spec in playwright.config.ts's "auth" project
// runs from the same machine/IP, sequentially (fullyParallel: false,
// workers: 1), so rather than exempting the E2E client from the limit it
// exists to test, this lets bursts of up to 3 sign-ups through immediately
// and then waits out the full window before the next burst.
const SIGN_UP_BURST_SIZE = 3;
const SIGN_UP_WINDOW_MS = 10_500;
let signUpsInWindow = 0;
let windowStartedAt = 0;

async function throttleSignUp(): Promise<void> {
  const now = Date.now();
  if (now - windowStartedAt >= SIGN_UP_WINDOW_MS) {
    signUpsInWindow = 0;
    windowStartedAt = now;
  }
  if (signUpsInWindow >= SIGN_UP_BURST_SIZE) {
    const waitMs = windowStartedAt + SIGN_UP_WINDOW_MS - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    signUpsInWindow = 0;
    windowStartedAt = Date.now();
  }
  signUpsInWindow += 1;
}

export interface SignUpFields {
  name: string;
  email: string;
}

// The module-level throttle state above only holds across sign-ups within a
// single worker process; Playwright restarts the worker after a failed test,
// which loses it. This owns the whole /cadastro submission as the backstop:
// on a rate-limited or a terms-not-accepted response, the Server Action
// re-renders the form with empty text inputs and checkboxes that report
// `isChecked() === true` even though nothing was submitted, so a retry
// re-navigates to /cadastro and re-fills and re-checks everything rather
// than trusting the DOM state or just re-clicking submit.
const SIGN_UP_MAX_ATTEMPTS = 3;

export async function signUp(page: Page, fields: SignUpFields): Promise<void> {
  await throttleSignUp();

  const nameInput = page.getByLabel("Nome");
  const emailInput = page.getByLabel("E-mail");
  const termsCheckbox = page.getByRole("checkbox", { name: /Aceito os termos de uso/ });
  const privacyCheckbox = page.getByRole("checkbox", {
    name: /Aceito a política de privacidade/,
  });
  const createAccountButton = page.getByRole("button", { name: "Criar conta" });
  const rateLimitedAlert = page.getByText("Muitas tentativas seguidas", { exact: false });
  const termsAlert = page.getByText(
    "Você precisa aceitar os termos de uso e a política de privacidade.",
    { exact: false },
  );

  const fillForm = async (): Promise<void> => {
    await page.goto("/cadastro");
    await nameInput.fill(fields.name);
    await emailInput.fill(fields.email);
    await termsCheckbox.check();
    await privacyCheckbox.check();
  };

  await fillForm();

  for (let attempt = 1; attempt <= SIGN_UP_MAX_ATTEMPTS; attempt += 1) {
    await createAccountButton.click();
    await Promise.race([
      page.waitForURL(/\/verificar-email\?email=/, { timeout: 15_000 }).catch(() => undefined),
      rateLimitedAlert.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
      termsAlert.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    ]);
    if (!page.url().includes("/cadastro")) {
      break;
    }
    if (attempt === SIGN_UP_MAX_ATTEMPTS) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, SIGN_UP_WINDOW_MS));
    await fillForm();
  }

  await expect(page).toHaveURL(/\/verificar-email\?email=/);
}

// The password is chosen after the verification link, which signs its
// opener in (docs/adr/0016, #144). Verification also clears the sign-up
// consent (docs/adr/0028's residual, closed by docs/adr/0036), so setting
// the password lands on /aceitar-termos, not the shell directly: the name
// field there is left empty on purpose (the name on file is the unproven
// registrant's), so this fills it again before checking both boxes.
export async function confirmEmailAndSetPassword(
  page: Page,
  verificationLink: string,
  password: string,
  baseURL: string | undefined,
  name: string,
): Promise<void> {
  await page.goto(verificationLink);
  await expect(page).toHaveURL(/\/definir-senha/);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Salvar senha" }).click();
  await expect(page).toHaveURL(/\/aceitar-termos/);
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(page).toHaveURL(baseURL ?? "/");
}

// The one place that reads a captured link back from the E2E-only route
// (docs/adr/0016). A read also deletes the link (auth/verification-link.ts).
// 404 means no link is waiting for that address (or the route is off); any
// other status fails at once rather than being polled on.
export async function tryReadLatestLink(
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<string | undefined> {
  const linkResponse = await request.get(
    `${baseURL ?? ""}/api/e2e/verification-link?email=${encodeURIComponent(email)}`,
    { headers: { "x-e2e-secret": secret } },
  );
  if (linkResponse.status() === 404) {
    return undefined;
  }
  expect(linkResponse.ok()).toBe(true);
  const { link } = (await linkResponse.json()) as { link: string };
  return link;
}

export async function readLatestLink(
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<string> {
  const link = await tryReadLatestLink(request, baseURL, email, secret);
  expect(link).toBeDefined();
  return link ?? "";
}

// `/sign-in/magic-link` and `/magic-link/verify` each allow 3 requests per
// 60s per IP (auth/options.ts, the magicLink plugin's rateLimit), counted
// from the last allowed request, and the whole suite shares one IP. Rather
// than raising the limit, a rate-limited step waits the window out and
// retries, extending the test's own timeout by exactly that wait.
const MAGIC_LINK_WINDOW_MS = 61_000;
const MAGIC_LINK_MAX_ATTEMPTS = 3;

async function waitOutRateLimit(page: Page, waitMs: number): Promise<void> {
  test.info().setTimeout(test.info().timeout + waitMs);
  await page.waitForTimeout(waitMs);
}

export async function requestMagicLink(page: Page, email: string): Promise<void> {
  const verifyPage = /\/link-magico\/verifique\?email=/;
  const rateLimitedAlert = page.getByText("Muitas tentativas seguidas", { exact: false });

  for (let attempt = 1; attempt <= MAGIC_LINK_MAX_ATTEMPTS; attempt += 1) {
    await page.goto("/link-magico");
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "Enviar link mágico" }).click();
    await Promise.race([
      page.waitForURL(verifyPage, { timeout: 15_000 }).catch(() => undefined),
      rateLimitedAlert.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    ]);
    if (verifyPage.test(page.url()) || attempt === MAGIC_LINK_MAX_ATTEMPTS) {
      break;
    }
    await waitOutRateLimit(page, MAGIC_LINK_WINDOW_MS);
  }

  await expect(page).toHaveURL(verifyPage);
}

export async function openMagicLink(page: Page, link: string): Promise<void> {
  for (let attempt = 1; attempt <= MAGIC_LINK_MAX_ATTEMPTS; attempt += 1) {
    const response = await page.goto(link);
    if (response?.status() !== 429 || attempt === MAGIC_LINK_MAX_ATTEMPTS) {
      return;
    }
    const retryAfterSeconds = Number(response.headers()["x-retry-after"]);
    await waitOutRateLimit(
      page,
      Number.isFinite(retryAfterSeconds) ? (retryAfterSeconds + 1) * 1000 : MAGIC_LINK_WINDOW_MS,
    );
  }
}
