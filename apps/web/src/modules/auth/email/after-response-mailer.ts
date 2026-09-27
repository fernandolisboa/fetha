import type { Mailer, SendEmailInput } from "./mailer";
import { EmailSendError } from "./resend-mailer";

export type RunAfterResponse = (task: () => Promise<void>) => void;

// Awaiting a real send on the request path makes a request for an address
// with an account measurably slower than one without, which enumerates
// accounts through magic link, password reset and sign-up (#114,
// docs/adr/0031). The send runs once the response is out; a failure can then
// only be logged, since nobody is left to answer.
export class AfterResponseMailer implements Mailer {
  constructor(
    private readonly inner: Mailer,
    private readonly runAfterResponse: RunAfterResponse,
  ) {}

  send(input: SendEmailInput): Promise<void> {
    this.runAfterResponse(async () => {
      try {
        await this.inner.send(input);
      } catch (error) {
        console.error(
          "email send failed",
          error instanceof EmailSendError
            ? error.code
            : error instanceof Error
              ? error.name
              : "Unknown",
        );
      }
    });
    return Promise.resolve();
  }
}
