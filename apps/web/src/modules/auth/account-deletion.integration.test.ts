import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => Promise.reject(new Error("no request scope")),
}));

import { getDb } from "@/db/client";
import { deleteTestInvite, deleteTestUser } from "@/db/test/cleanup";
import { seedUserFootprint } from "@/db/test/user-footprint";
import { strategies, strategyVersions } from "@/modules/strategies/schema";

import { getAuth } from "./auth";
import { invites, mailOutbox, user } from "./schema";
import { deleteAccount, signUp } from "./service";
import { testRequestHeaders } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.REGISTRATION_MODE = "open";

const PASSWORD = "correct-horse-battery";

function uniqueEmail(label: string): string {
  return `fetha-delete-${label}-${crypto.randomUUID()}@example.com`;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
    await deleteTestInvite(db, email);
  }
});

// A real, verified, signed-in account: the deletion goes through Better
// Auth's handler exactly as the Server Action does.
async function signedInUser(label: string) {
  const email = uniqueEmail(label);
  createdEmails.push(email);
  const ip = testRequestHeaders();
  const outcome = await signUp(
    { name: "Delete Me", email, password: PASSWORD, termsAccepted: true, privacyAccepted: true },
    ip,
  );
  expect(outcome.status).toBe("ok");
  const link = await findLatestVerificationLink(getDb(), email);
  const token = link ? new URL(link).searchParams.get("token") : null;
  if (!token) {
    throw new Error(`no verification link for ${email}`);
  }
  await getAuth().api.verifyEmail({ query: { token } });
  const signInResponse = await getAuth().api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  const cookie = signInResponse.headers.get("set-cookie") ?? "";
  const headers = testRequestHeaders();
  headers.set("cookie", cookie);
  headers.set("origin", "http://localhost:3000");
  const row = await getDb().query.user.findFirst({ where: eq(user.email, email) });
  if (!row) {
    throw new Error("signed-up user not found");
  }
  return { owner: { id: row.id, name: row.name, email }, headers };
}

async function insertBareUser(email: string): Promise<{ id: string; name: string; email: string }> {
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Bystander",
      email,
      emailVerified: true,
      termsVersion: "2026-09-09",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: user.id, name: user.name, email: user.email });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

async function rowsPerUserTable(userId: string): Promise<Record<string, number>> {
  const tables = await getDb().execute<{ table_name: string }>(
    sql`select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id'`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables.rows) {
    const result = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${userId}`,
    );
    counts[table] = result.rows[0]?.n ?? 0;
  }
  return counts;
}

describe("account deletion", () => {
  it("leaves no row of the deleted user in any table, and no one else's row goes", async () => {
    const db = getDb();
    const { owner, headers } = await signedInUser("full");
    const footprint = await seedUserFootprint(db, owner, { withAuthRows: false });

    const bystanderEmail = uniqueEmail("bystander");
    createdEmails.push(bystanderEmail);
    const bystander = await insertBareUser(bystanderEmail);
    await seedUserFootprint(db, bystander);
    const [copy] = await db
      .insert(strategies)
      .values({
        userId: bystander.id,
        name: "copy",
        copiedFromStrategyId: footprint.strategyId,
      })
      .returning({ id: strategies.id });
    const bystanderBefore = await rowsPerUserTable(bystander.id);

    const outcome = await deleteAccount(PASSWORD, headers);

    expect(outcome).toEqual({ status: "ok" });
    const left = await rowsPerUserTable(owner.id);
    expect(Object.keys(left).length).toBeGreaterThan(15);
    for (const [table, count] of Object.entries(left)) {
      expect(count, table).toBe(0);
    }
    expect(await db.select().from(user).where(eq(user.id, owner.id))).toEqual([]);
    expect(
      await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.strategyId, footprint.strategyId)),
    ).toEqual([]);
    expect(await db.select().from(invites).where(eq(invites.email, owner.email))).toEqual([]);
    expect(await db.select().from(mailOutbox).where(eq(mailOutbox.to, owner.email))).toEqual([]);

    expect(await rowsPerUserTable(bystander.id)).toEqual(bystanderBefore);
    const [survivor] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, copy?.id ?? ""));
    expect(survivor?.copiedFromStrategyId).toBeNull();
  });

  it("keeps the account on a wrong password", async () => {
    const { owner, headers } = await signedInUser("wrong");

    const outcome = await deleteAccount("not-the-password", headers);

    expect(outcome).toEqual({ status: "invalid_password" });
    expect(await getDb().select().from(user).where(eq(user.id, owner.id))).toHaveLength(1);
  });

  it("refuses a direct call without a password, even on a fresh session", async () => {
    const { owner, headers } = await signedInUser("no-password");
    headers.set("content-type", "application/json");

    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/delete-user", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(await getDb().select().from(user).where(eq(user.id, owner.id))).toHaveLength(1);
  });

  it("refuses a direct call that carries a deletion token", async () => {
    const { owner, headers } = await signedInUser("token");
    headers.set("content-type", "application/json");

    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/delete-user", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: PASSWORD, token: "anything" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await getDb().select().from(user).where(eq(user.id, owner.id))).toHaveLength(1);
  });

  it("closes the emailed-link deletion path", async () => {
    const { owner, headers } = await signedInUser("callback");

    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/delete-user/callback?token=anything", {
        headers,
      }),
    );

    expect(response.status).toBe(404);
    expect(await getDb().select().from(user).where(eq(user.id, owner.id))).toHaveLength(1);
  });

  it("refuses without a session", async () => {
    const outcome = await deleteAccount(PASSWORD, testRequestHeaders());

    expect(outcome).toEqual({ status: "failed" });
  });
});
