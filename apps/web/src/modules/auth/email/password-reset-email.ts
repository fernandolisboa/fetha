import { t } from "../strings";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PasswordResetEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildPasswordResetEmail(url: string): PasswordResetEmail {
  const copy = t.passwordResetEmail;
  return {
    subject: copy.subject,
    text: copy.text.replaceAll("{url}", url),
    html: copy.html.replaceAll("{url}", escapeHtml(url)),
  };
}
