import { betterAuth } from "better-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { AfterResponseMailer } from "./email/after-response-mailer";
import type { Mailer, SendEmailInput } from "./email/mailer";
import { buildAuthOptions } from "./options";
import { registerVerifiedUser } from "./registration-test-support";
import { testRequestHeaders } from "./test-support";

const RESPONSE_DEADLINE_MS = 5000;

function uniqueEmail(label: string): string {
  return `fetha-mail-timing-${label}-${crypto.randomUUID()}@example.com`;
}

// A mailer whose sends hang until released: a request that awaited a send
// could never answer, whichever branch it took.
class GatedMailer implements Mailer {
  readonly sent: SendEmailInput[] = [];
  private release: () => void = () => undefined;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async send(input: SendEmailInput): Promise<void> {
    await this.gate;
    this.sent.push(input);
  }

  open(): void {
    this.release();
  }
}

function setUp() {
  const gated = new GatedMailer();
  const scheduled: (() => Promise<void>)[] = [];
  const mailer = new AfterResponseMailer(gated, (task) => {
    scheduled.push(task);
  });
  const auth = betterAuth(buildAuthOptions(getDb(), process.env, mailer));

  async function post(path: string, body: unknown): Promise<Response> {
    const headers = testRequestHeaders();
    headers.set("content-type", "application/json");
    const request = new Request(new URL(`/api/auth${path}`, process.env.BETTER_AUTH_URL), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${path} waited on the mailer`));
      }, RESPONSE_DEADLINE_MS);
    });
    try {
      return await Promise.race([auth.handler(request), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function flush(): Promise<string[]> {
    gated.open();
    await Promise.all(scheduled.splice(0).map((task) => task()));
    return gated.sent.map((mail) => mail.to);
  }

  return { post, flush };
}

const createdEmails: string[] = [];

beforeEach(() => {
  process.env.REGISTRATION_MODE = "open";
});

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function existingAccount(label: string): Promise<string> {
  const email = uniqueEmail(label);
  createdEmails.push(email);
  await registerVerifiedUser(
    { name: "Timing User", email, password: "correct-horse-battery" },
    testRequestHeaders(),
  );
  return email;
}

describe("mail sends stay off the request path (#114)", () => {
  it("answers a magic-link request the same way with and without an account", async () => {
    const existing = await existingAccount("magic-existing");
    const unknown = uniqueEmail("magic-unknown");
    const { post, flush } = setUp();

    const withAccount = await post("/sign-in/magic-link", { email: existing });
    const withoutAccount = await post("/sign-in/magic-link", { email: unknown });

    expect(withAccount.status).toBe(200);
    expect(withoutAccount.status).toBe(200);
    expect(await withAccount.json()).toEqual(await withoutAccount.json());
    expect(await flush()).toEqual([existing]);
  });

  it("answers a password-reset request the same way with and without an account", async () => {
    const existing = await existingAccount("reset-existing");
    const unknown = uniqueEmail("reset-unknown");
    const { post, flush } = setUp();

    const body = { redirectTo: "/redefinir-senha/confirmar" };
    const withAccount = await post("/request-password-reset", { ...body, email: existing });
    const withoutAccount = await post("/request-password-reset", { ...body, email: unknown });

    expect(withAccount.status).toBe(200);
    expect(withoutAccount.status).toBe(200);
    expect(await withAccount.json()).toEqual(await withoutAccount.json());
    expect(await flush()).toEqual([existing]);
  });

  it("answers a sign-up the same way for a new and an already registered email", async () => {
    const existing = await existingAccount("sign-up-existing");
    const fresh = uniqueEmail("sign-up-new");
    createdEmails.push(fresh);
    const { post, flush } = setUp();

    const signUpBody = (email: string) => ({
      name: "Timing User",
      email,
      password: crypto.randomUUID(),
      termsAccepted: true,
      privacyAccepted: true,
      callbackURL: "/verificar-email/resultado",
    });
    const forExisting = await post("/sign-up/email", signUpBody(existing));
    const forFresh = await post("/sign-up/email", signUpBody(fresh));

    expect(forExisting.status).toBe(200);
    expect(forFresh.status).toBe(200);
    const existingBody = (await forExisting.json()) as object;
    const freshBody = (await forFresh.json()) as object;
    expect(Object.keys(existingBody)).toEqual(Object.keys(freshBody));
    expect(await flush()).toEqual([fresh]);
  });
});
