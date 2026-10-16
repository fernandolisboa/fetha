import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.REGISTRATION_MODE = "open";

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(currentHeaders) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { openVerificationLink } from "@/modules/auth/registration-test-support";
import { signUp } from "@/modules/auth/service";
import { testRequestHeaders, uniqueTestIp } from "@/modules/auth/test-support";

import {
  removeAnthropicApiKeyAction,
  saveAnthropicApiKeyAction,
  setAnalysisModelFamilyAction,
  testAnthropicApiKeyAction,
} from "./actions";
import { AiSettingsRepository } from "./ai-settings-repository";
import { readBetterAuthSecret } from "./env";

const createdEmails: string[] = [];

function uniqueEmail(label: string): string {
  return `fetha-ai-settings-actions-${label}-${crypto.randomUUID()}@example.com`;
}

async function signUpAndVerify(label: string): Promise<{ email: string; sessionHeaders: Headers }> {
  const email = uniqueEmail(label);
  createdEmails.push(email);
  const outcome = await signUp(
    { name: label, email, termsAccepted: true, privacyAccepted: true },
    testRequestHeaders(uniqueTestIp()),
  );
  if (outcome.status !== "ok") {
    throw new Error(`sign-up failed for ${email}: ${outcome.status}`);
  }
  const sessionHeaders = await openVerificationLink(email);
  return { email, sessionHeaders };
}

beforeEach(() => {
  currentHeaders = new Headers();
});

afterEach(async () => {
  vi.restoreAllMocks();
  currentHeaders = new Headers();
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("setAnalysisModelFamilyAction", () => {
  it("stores a chosen family and clearing it back to default removes the override", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("family");
    currentHeaders = sessionHeaders;

    const result = await setAnalysisModelFamilyAction({ kind: "signal", family: "haiku" });
    expect(result).toEqual({ status: "ok" });

    const user = await signInUser(email);
    expect(await new AiSettingsRepository(getDb(), user).getModelFamilies()).toEqual({
      signal: "haiku",
    });

    currentHeaders = sessionHeaders;
    await setAnalysisModelFamilyAction({ kind: "signal", family: "default" });
    expect(await new AiSettingsRepository(getDb(), user).getModelFamilies()).toEqual({});
  });

  it("rate limits after 20 saves in the window, the 21st returns rate_limited", async () => {
    const { sessionHeaders } = await signUpAndVerify("family-rate-limit");
    currentHeaders = sessionHeaders;

    const outcomes = [];
    for (let i = 0; i < 21; i += 1) {
      outcomes.push(
        await setAnalysisModelFamilyAction({
          kind: "signal",
          family: i % 2 === 0 ? "haiku" : "default",
        }),
      );
    }
    expect(outcomes.slice(0, 20).every((outcome) => outcome.status === "ok")).toBe(true);
    expect(outcomes[20]).toEqual({ status: "error", error: "rate_limited" });
  });

  it("rejects an invalid kind", async () => {
    const { sessionHeaders } = await signUpAndVerify("family-invalid");
    currentHeaders = sessionHeaders;

    const result = await setAnalysisModelFamilyAction({
      // @ts-expect-error intentionally invalid for the test
      kind: "nonsense",
      family: "haiku",
    });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });
});

describe("saveAnthropicApiKeyAction / testAnthropicApiKeyAction / removeAnthropicApiKeyAction", () => {
  it("rejects a key that does not look like an Anthropic key before any network call", async () => {
    const { sessionHeaders } = await signUpAndVerify("badshape");
    currentHeaders = sessionHeaders;

    const result = await saveAnthropicApiKeyAction({ key: "not-a-key" });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("saves a key that validates, then tests and removes it", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("roundtrip");
    vi.spyOn(Anthropic.Models.prototype, "list").mockResolvedValue({
      data: [],
    } as never);

    currentHeaders = sessionHeaders;
    const saved = await saveAnthropicApiKeyAction({
      key: "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(saved).toEqual({ status: "ok", last4: "aaaa" });

    const user = await signInUser(email);
    const status = await new AiSettingsRepository(getDb(), user).getApiKeyStatus(
      readBetterAuthSecret(),
    );
    expect(status).toMatchObject({ configured: true, last4: "aaaa", readable: true });

    currentHeaders = sessionHeaders;
    const tested = await testAnthropicApiKeyAction();
    expect(tested).toEqual({ status: "ok_tested" });

    currentHeaders = sessionHeaders;
    const removed = await removeAnthropicApiKeyAction();
    expect(removed).toEqual({ status: "ok_removed" });
    expect(
      await new AiSettingsRepository(getDb(), user).getApiKeyStatus(readBetterAuthSecret()),
    ).toMatchObject({ configured: false });
  });

  it("does not store a key Anthropic rejects as invalid", async () => {
    const { sessionHeaders } = await signUpAndVerify("rejected");
    vi.spyOn(Anthropic.Models.prototype, "list").mockRejectedValue(
      new Anthropic.AuthenticationError(401, {}, "invalid", new Headers()),
    );

    currentHeaders = sessionHeaders;
    const result = await saveAnthropicApiKeyAction({
      key: "sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(result).toEqual({ status: "error", error: "key_invalid" });
  });

  it("answers no_key when testing with nothing stored", async () => {
    const { sessionHeaders } = await signUpAndVerify("notest");
    currentHeaders = sessionHeaders;

    const result = await testAnthropicApiKeyAction();
    expect(result).toEqual({ status: "error", error: "no_key" });
  });
});

async function signInUser(email: string): Promise<{ id: string }> {
  const { user } = await import("@/modules/auth/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) {
    throw new Error(`no user found for ${email}`);
  }
  return row;
}
