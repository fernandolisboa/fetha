import Anthropic from "@anthropic-ai/sdk";
import { pinnedModels } from "@fetha/prompts";
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

import { saveAnthropicApiKeyAction, setAnalysisModelFamilyAction } from "./actions";
import { getMyAiSettings, isAnalysisAvailable } from "./queries";

const createdEmails: string[] = [];

function uniqueEmail(label: string): string {
  return `fetha-ai-settings-queries-${label}-${crypto.randomUUID()}@example.com`;
}

async function signUpAndVerify(label: string): Promise<{ sessionHeaders: Headers }> {
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
  return { sessionHeaders };
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

describe("getMyAiSettings", () => {
  it("defaults every kind to its own family and no stored key", async () => {
    const { sessionHeaders } = await signUpAndVerify("default");
    currentHeaders = sessionHeaders;

    const settings = await getMyAiSettings();

    expect(settings.modelFamilies).toEqual({});
    expect(settings.apiKey).toMatchObject({ configured: false });
    expect(Object.keys(settings.resolvedModels)).toEqual([
      "signal",
      "contemplated_operation",
      "held_operation",
      "backtest_run",
      "suggestion",
      "research",
    ]);
  });

  it("reflects a stored family override in resolvedModels", async () => {
    const { sessionHeaders } = await signUpAndVerify("family");
    currentHeaders = sessionHeaders;

    await setAnalysisModelFamilyAction({ kind: "signal", family: "opus" });

    currentHeaders = sessionHeaders;
    const settings = await getMyAiSettings();

    expect(settings.modelFamilies).toEqual({ signal: "opus" });
    expect(settings.resolvedModels.signal).toBe(pinnedModels.opus);
  });
});

describe("isAnalysisAvailable", () => {
  const originalServerKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalServerKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalServerKey;
    }
  });

  it("is false with a server key configured but no own key (#325)", async () => {
    const { sessionHeaders } = await signUpAndVerify("available-server-only");
    currentHeaders = sessionHeaders;
    process.env.ANTHROPIC_API_KEY = "sk-server-test";

    expect(await isAnalysisAvailable()).toBe(false);
  });

  it("is false with neither key", async () => {
    const { sessionHeaders } = await signUpAndVerify("available-none");
    currentHeaders = sessionHeaders;
    delete process.env.ANTHROPIC_API_KEY;

    expect(await isAnalysisAvailable()).toBe(false);
  });

  it("is true once the user saves a readable own key, server key or not", async () => {
    const { sessionHeaders } = await signUpAndVerify("available-own-key");
    vi.spyOn(Anthropic.Models.prototype, "list").mockResolvedValue({ data: [] } as never);

    process.env.ANTHROPIC_API_KEY = "sk-server-test";
    currentHeaders = sessionHeaders;
    const saved = await saveAnthropicApiKeyAction({
      key: "sk-ant-api03-cccccccccccccccccccccccccccc",
    });
    expect(saved).toMatchObject({ status: "ok" });

    currentHeaders = sessionHeaders;
    expect(await isAnalysisAvailable()).toBe(true);

    delete process.env.ANTHROPIC_API_KEY;
    currentHeaders = sessionHeaders;
    expect(await isAnalysisAvailable()).toBe(true);
  });
});
