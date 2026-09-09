import { lt } from "drizzle-orm";

import { getDb } from "@/db/client";
import { mailOutbox } from "@/db/schema/mail-outbox";

import type { Mailer, SendEmailInput } from "./mailer";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Non-production deployments never send real email; they capture it so
// Playwright can read the verification link back through the E2E-only
// route. mail_outbox only ever holds recent test fixtures (ADR-0016), so
// every insert also purges anything older than a day.
export class CaptureMailer implements Mailer {
  async send(input: SendEmailInput): Promise<void> {
    const db = getDb();
    await db.delete(mailOutbox).where(lt(mailOutbox.sentAt, new Date(Date.now() - ONE_DAY_MS)));
    await db.insert(mailOutbox).values(input);
  }
}
