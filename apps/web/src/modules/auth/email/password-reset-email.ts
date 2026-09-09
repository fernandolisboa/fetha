import { t } from "../strings";
import { buildLinkEmail, type LinkEmail } from "./link-email";

export type PasswordResetEmail = LinkEmail;

export function buildPasswordResetEmail(url: string): PasswordResetEmail {
  return buildLinkEmail(t.passwordResetEmail, url);
}
