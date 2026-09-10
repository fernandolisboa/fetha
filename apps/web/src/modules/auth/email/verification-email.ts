import { t } from "../strings";
import { escapeHtml } from "./escape-html";

export interface VerificationEmail {
  subject: string;
  text: string;
  html: string;
}

// The name comes from the sign-up form: a plain-text field, never parsed as
// markup by an email client, so only the HTML part needs escaping.
export function buildVerificationEmail(name: string, url: string): VerificationEmail {
  const copy = t.verificationEmail;
  return {
    subject: copy.subject,
    text: copy.text.replaceAll("{name}", name).replaceAll("{url}", url),
    html: copy.html.replaceAll("{name}", escapeHtml(name)).replaceAll("{url}", escapeHtml(url)),
  };
}
