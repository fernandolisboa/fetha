import { describe, expect, it } from "vitest";

import { CaptureMailer } from "./capture-mailer";
import { CaptureMailerRefusedInProductionError, getMailer } from "./select";
import { ResendMailer } from "./resend-mailer";

describe("getMailer", () => {
  it("selects ResendMailer by default in production deployments", () => {
    expect(getMailer({ VERCEL_ENV: "production" })).toBeInstanceOf(ResendMailer);
  });

  it("selects CaptureMailer by default for preview, development and local deployments", () => {
    expect(getMailer({ VERCEL_ENV: "preview" })).toBeInstanceOf(CaptureMailer);
    expect(getMailer({})).toBeInstanceOf(CaptureMailer);
  });

  it("honors an explicit MAILER override in either direction", () => {
    expect(getMailer({ VERCEL_ENV: "production", MAILER: "capture" })).toBeInstanceOf(
      CaptureMailer,
    );
    expect(getMailer({ VERCEL_ENV: "preview", MAILER: "resend" })).toBeInstanceOf(ResendMailer);
  });

  it("refuses CaptureMailer when the database host matches the production marker", () => {
    expect(() =>
      getMailer({
        DATABASE_URL: "postgres://user:pass@ep-fetha-production-abc.aws.neon.tech/db",
      }),
    ).toThrow(CaptureMailerRefusedInProductionError);
  });

  it("does not refuse ResendMailer against a production database host", () => {
    expect(
      getMailer({
        MAILER: "resend",
        DATABASE_URL: "postgres://user:pass@ep-fetha-production-abc.aws.neon.tech/db",
      }),
    ).toBeInstanceOf(ResendMailer);
  });
});
