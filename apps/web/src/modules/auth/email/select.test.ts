import { describe, expect, it } from "vitest";

import { CaptureMailer } from "./capture-mailer";
import { getMailer } from "./select";
import { ResendMailer } from "./resend-mailer";

describe("getMailer", () => {
  it("selects ResendMailer only in production deployments", () => {
    expect(getMailer({ VERCEL_ENV: "production" })).toBeInstanceOf(ResendMailer);
  });

  it("selects CaptureMailer for preview, development and local deployments", () => {
    expect(getMailer({ VERCEL_ENV: "preview" })).toBeInstanceOf(CaptureMailer);
    expect(getMailer({})).toBeInstanceOf(CaptureMailer);
  });
});
