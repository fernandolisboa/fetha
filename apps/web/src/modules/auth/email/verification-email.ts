import { t } from "../strings";

// The name comes from the sign-up form: a plain-text field, never parsed as
// markup by an email client, so only the HTML part needs escaping.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface VerificationEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildVerificationEmail(name: string, url: string): VerificationEmail {
  const copy = t.verificationEmail;
  return {
    subject: copy.subject,
    text: copy.text.replaceAll("{name}", name).replaceAll("{url}", url),
    html: copy.html.replaceAll("{name}", escapeHtml(name)).replaceAll("{url}", escapeHtml(url)),
  };
}
