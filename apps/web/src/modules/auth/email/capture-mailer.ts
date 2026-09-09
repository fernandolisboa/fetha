import { getDb } from "@/db/client";
import { mailOutbox } from "@/db/schema/mail-outbox";

import type { Mailer, SendEmailInput } from "./mailer";

// Non-production deployments never send real email; they capture it so
// Playwright can read the verification link back through the E2E-only route.
export class CaptureMailer implements Mailer {
  async send(input: SendEmailInput): Promise<void> {
    await getDb().insert(mailOutbox).values(input);
  }
}
