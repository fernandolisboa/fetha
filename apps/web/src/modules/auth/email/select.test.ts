import { describe, expect, it } from "vitest";

import { AfterResponseMailer } from "./after-response-mailer";
import { CaptureMailer } from "./capture-mailer";
import { CaptureMailerRefusedInProductionError, getMailer } from "./select";

describe("getMailer", () => {
  it("selects Resend, sent after the response, by default in production deployments", () => {
    expect(getMailer({ VERCEL_ENV: "production" })).toBeInstanceOf(AfterResponseMailer);
  });

  it("selects CaptureMailer by default for preview, development and local deployments", () => {
    expect(getMailer({ VERCEL_ENV: "preview" })).toBeInstanceOf(CaptureMailer);
    expect(getMailer({})).toBeInstanceOf(CaptureMailer);
  });

  it("honors an explicit MAILER override in either direction", () => {
    expect(getMailer({ VERCEL_ENV: "production", MAILER: "capture" })).toBeInstanceOf(
      CaptureMailer,
    );
    expect(getMailer({ VERCEL_ENV: "preview", MAILER: "resend" })).toBeInstanceOf(
      AfterResponseMailer,
    );
  });

  it("refuses CaptureMailer when the database host is the production host", () => {
    expect(() =>
      getMailer({
        DATABASE_URL:
          "postgres://user:pass@ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech/db",
      }),
    ).toThrow(CaptureMailerRefusedInProductionError);
  });

  it("does not refuse Resend against a production database host", () => {
    expect(
      getMailer({
        MAILER: "resend",
        DATABASE_URL:
          "postgres://user:pass@ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech/db",
      }),
    ).toBeInstanceOf(AfterResponseMailer);
  });
});
