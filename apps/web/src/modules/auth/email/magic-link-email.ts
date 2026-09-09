import { t } from "../strings";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface MagicLinkEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildMagicLinkEmail(url: string): MagicLinkEmail {
  const copy = t.magicLinkEmail;
  return {
    subject: copy.subject,
    text: copy.text.replaceAll("{url}", url),
    html: copy.html.replaceAll("{url}", escapeHtml(url)),
  };
}
