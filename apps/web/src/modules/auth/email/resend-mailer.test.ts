import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MissingEmailFromError, MissingResendApiKeyError, ResendMailer } from "./resend-mailer";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("ResendMailer", () => {
  it("throws when RESEND_API_KEY is not set", async () => {
    const mailer = new ResendMailer();
    await expect(
      mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toBeInstanceOf(MissingResendApiKeyError);
  });

  it("throws when EMAIL_FROM is not set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const mailer = new ResendMailer();
    await expect(
      mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toBeInstanceOf(MissingEmailFromError);
  });
});
