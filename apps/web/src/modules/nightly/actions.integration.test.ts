import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.REGISTRATION_MODE = "open";

const runNightlyJobMock = vi.hoisted(() => vi.fn());
vi.mock("./run-nightly-job", () => ({ runNightlyJob: runNightlyJobMock }));

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(currentHeaders) }));

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { accessLog } from "@/modules/audit/schema";
import { openVerificationLink } from "@/modules/auth/registration-test-support";
import { user } from "@/modules/auth/schema";
import { signUp } from "@/modules/auth/service";
import { testRequestHeaders, uniqueTestIp } from "@/modules/auth/test-support";

async function accessLogEventsFor(email: string): Promise<string[]> {
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) {
    return [];
  }
  const rows = await getDb().select().from(accessLog).where(eq(accessLog.userId, row.id));
  return rows.map((entry) => entry.event);
}

function uniqueEmail(label: string): string {
  return `fetha-nightly-actions-${label}-${crypto.randomUUID()}@example.com`;
}

const createdEmails: string[] = [];
const originalOwnerEmails = process.env.OWNER_EMAILS;

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
  runNightlyJobMock.mockReset();
  runNightlyJobMock.mockResolvedValue({
    ok: true,
    session: "2026-09-08",
    okSessions: ["2026-09-08"],
    sources: [],
    evaluation: null,
    scoring: {
      asOfSession: "2026-09-08",
      usersScored: 0,
      usersSkipped: 0,
      decisionsScored: 0,
      decisionsSkipped: 0,
      errors: [],
    },
    accessLogPurge: { ok: true, deleted: 0 },
    unverifiedAccountPurge: { ok: true, deleted: 0 },
    sessionPurge: { ok: true, deleted: 0 },
  });
});

afterEach(async () => {
  process.env.OWNER_EMAILS = originalOwnerEmails;
  currentHeaders = new Headers();
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("triggerNightlyJobAction against real sessions", () => {
  it("is forbidden for a signed-out caller and never invokes the job", async () => {
    process.env.OWNER_EMAILS = "";
    currentHeaders = new Headers();
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(result).toEqual({ status: "forbidden" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
  });

  it("is forbidden for a real, verified, signed-in non-owner session and records no access", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("non-owner");
    process.env.OWNER_EMAILS = "somebody-else@example.com";
    currentHeaders = sessionHeaders;
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(result).toEqual({ status: "forbidden" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
    expect(await accessLogEventsFor(email)).not.toContain("nightly_triggered");
  });

  it("is ok for a real, verified, signed-in owner session and records the access", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("owner");
    process.env.OWNER_EMAILS = email;
    currentHeaders = sessionHeaders;
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "2026-09-08" });

    expect(runNightlyJobMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "ok", summary: { ok: true, session: "2026-09-08" } });
    expect(await accessLogEventsFor(email)).toContain("nightly_triggered");
  });
});
