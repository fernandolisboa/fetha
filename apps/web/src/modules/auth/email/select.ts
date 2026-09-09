import { CaptureMailer } from "./capture-mailer";
import type { Mailer } from "./mailer";
import { ResendMailer } from "./resend-mailer";
import { isProductionDatabaseHost, isProductionDeployment, type AuthEnv } from "../env";

export class CaptureMailerRefusedInProductionError extends Error {
  constructor() {
    super("Refusing to select CaptureMailer against a production database");
    this.name = "CaptureMailerRefusedInProductionError";
  }
}

type MailerChoice = "resend" | "capture";

function resolveMailerChoice(env: AuthEnv): MailerChoice {
  if (env.MAILER === "resend" || env.MAILER === "capture") {
    return env.MAILER;
  }
  return isProductionDeployment(env) ? "resend" : "capture";
}

export function getMailer(env: AuthEnv = process.env): Mailer {
  const choice = resolveMailerChoice(env);

  if (choice === "capture") {
    if (isProductionDatabaseHost(env)) {
      throw new CaptureMailerRefusedInProductionError();
    }
    return new CaptureMailer();
  }

  return new ResendMailer();
}
