import { escapeHtml } from "./escape-html";

export interface LinkEmail {
  subject: string;
  text: string;
  html: string;
}

export interface LinkEmailCopy {
  subject: string;
  text: string;
  html: string;
}

// Shared by every one-link, no-name email (magic link, password reset): a
// subject plus a text/html pair with a single `{url}` placeholder.
export function buildLinkEmail(copy: LinkEmailCopy, url: string): LinkEmail {
  return {
    subject: copy.subject,
    text: copy.text.replaceAll("{url}", url),
    html: copy.html.replaceAll("{url}", escapeHtml(url)),
  };
}
