import { pinnedModels } from "@fetha/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.REGISTRATION_MODE = "open";

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(currentHeaders) }));

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { openVerificationLink } from "@/modules/auth/registration-test-support";
import { signUp } from "@/modules/auth/service";
import { testRequestHeaders, uniqueTestIp } from "@/modules/auth/test-support";

import { setAnalysisModelFamilyAction } from "./actions";
import { getMyAiSettings } from "./queries";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

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
