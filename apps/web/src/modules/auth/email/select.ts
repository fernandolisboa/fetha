import { CaptureMailer } from "./capture-mailer";
import type { Mailer } from "./mailer";
import { ResendMailer } from "./resend-mailer";
import { isProductionDeployment, type AuthEnv } from "../env";

export function getMailer(env: AuthEnv = process.env): Mailer {
  return isProductionDeployment(env) ? new ResendMailer() : new CaptureMailer();
}
