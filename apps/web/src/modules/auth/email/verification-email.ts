import { t } from "../strings";
import { escapeHtml } from "./escape-html";

export interface VerificationEmail {
  subject: string;
  text: string;
  html: string;
}

// No name in the body: whoever signs up chooses it, and with open
// registration that can be someone other than the mailbox owner (#45).
export function buildVerificationEmail(url: string): VerificationEmail {
  const copy = t.verificationEmail;
  return {
    subject: copy.subject,
    text: copy.text.replaceAll("{url}", url),
    html: copy.html.replaceAll("{url}", escapeHtml(url)),
  };
}
