import type { Mailer, SendEmailInput } from "./mailer";

export class FakeMailer implements Mailer {
  readonly sent: SendEmailInput[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the Mailer contract without real I/O.
  async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
  }
}
