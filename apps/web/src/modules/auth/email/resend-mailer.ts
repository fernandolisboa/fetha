import { Resend } from "resend";

import type { Mailer, SendEmailInput } from "./mailer";

export class MissingResendApiKeyError extends Error {
  constructor() {
    super("RESEND_API_KEY is not set");
    this.name = "MissingResendApiKeyError";
  }
}

export class MissingEmailFromError extends Error {
  constructor() {
    super("EMAIL_FROM is not set");
    this.name = "MissingEmailFromError";
  }
}

export class EmailSendError extends Error {
  // Resend's error name (e.g. `validation_error`), safe to log: unlike the
  // message, it never quotes the recipient.
  readonly code: string;

  constructor(reason: string, code: string) {
    super(`Resend refused to send the email: ${reason}`);
    this.name = "EmailSendError";
    this.code = code;
  }
}

export class ResendMailer implements Mailer {
  async send(input: SendEmailInput): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new MissingResendApiKeyError();
    }
    const from = process.env.EMAIL_FROM;
    if (!from) {
      throw new MissingEmailFromError();
    }

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    if (error) {
      throw new EmailSendError(error.message, error.name);
    }
  }
}
