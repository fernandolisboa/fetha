import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

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
  password: string;
}

// The module-level throttle state above only holds across sign-ups within a
// single worker process; Playwright restarts the worker after a failed test,
// which loses it. This owns the whole /cadastro submission as the backstop:
// on a rate-limited response the Server Action re-renders the form with
// empty text inputs (checkboxes stay checked), so a retry has to re-fill
// name/e-mail/senha rather than just re-clicking submit.
const SIGN_UP_MAX_ATTEMPTS = 3;

export async function signUp(page: Page, fields: SignUpFields): Promise<void> {
  await throttleSignUp();

  const nameInput = page.getByLabel("Nome");
  const emailInput = page.getByLabel("E-mail");
  const passwordInput = page.getByLabel("Senha");
  const termsCheckbox = page.getByRole("checkbox", { name: /Aceito os termos de uso/ });
  const privacyCheckbox = page.getByRole("checkbox", {
    name: /Aceito a política de privacidade/,
  });
  const createAccountButton = page.getByRole("button", { name: "Criar conta" });
  const rateLimitedAlert = page.getByText("Muitas tentativas seguidas", { exact: false });

  const fillForm = async (): Promise<void> => {
    await nameInput.fill(fields.name);
    await emailInput.fill(fields.email);
    await passwordInput.fill(fields.password);
    if (!(await termsCheckbox.isChecked())) {
      await termsCheckbox.check();
    }
    if (!(await privacyCheckbox.isChecked())) {
      await privacyCheckbox.check();
    }
  };

  await page.goto("/cadastro");
  await fillForm();

  for (let attempt = 1; attempt <= SIGN_UP_MAX_ATTEMPTS; attempt += 1) {
    await createAccountButton.click();
    await Promise.race([
      page.waitForURL(/\/verificar-email\?email=/, { timeout: 15_000 }).catch(() => undefined),
      rateLimitedAlert.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
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
