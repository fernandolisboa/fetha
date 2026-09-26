import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestInvite, deleteTestUser } from "@/db/test/cleanup";
import { seedUserFootprint } from "@/db/test/user-footprint";
import { user } from "@/modules/auth/schema";

import { accountExportStream, EXPORT_FORMAT } from "./data-export";

interface ExportDocument {
  format: string;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

function uniqueEmail(label: string): string {
  return `fetha-export-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<{ id: string; name: string; email: string }> {
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
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

async function readExport(owner: { id: string; name: string; email: string }) {
  const exportedAt = new Date("2026-09-26T12:00:00Z");
  const text = await new Response(accountExportStream(getDb(), owner, exportedAt)).text();
  return { text, document: JSON.parse(text) as ExportDocument };
}

async function tablesWithUserId(): Promise<string[]> {
  const result = await getDb().execute<{ table_name: string }>(
    sql`select table_name from information_schema.columns
        where table_schema = 'public' and (column_name = 'user_id' or column_name like '%\\_user\\_id')`,
  );
  return result.rows.map((row) => row.table_name);
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
    await deleteTestInvite(db, email);
  }
});

async function twoSeededUsers(label: string) {
  const emailA = uniqueEmail(`${label}-a`);
  const emailB = uniqueEmail(`${label}-b`);
  createdEmails.push(emailA, emailB);
  const userA = await insertBareUser(emailA);
  const userB = await insertBareUser(emailB);
  await seedUserFootprint(getDb(), userA);
  const footprintB = await seedUserFootprint(getDb(), userB);
  return { userA, userB, footprintB };
}

describe("account data export", () => {
  it("covers every table that holds a user's data, each with the user's rows", async () => {
    const { userA } = await twoSeededUsers("coverage");

    const { document } = await readExport(userA);

    expect(document.format).toBe(EXPORT_FORMAT);
    expect(document.exportedAt).toBe("2026-09-26T12:00:00.000Z");
    const expected = [...(await tablesWithUserId()), "user", "strategy_versions"];
    for (const table of expected) {
      expect(document.tables[table], table).toBeDefined();
      expect(document.tables[table]?.length, table).toBeGreaterThan(0);
    }
  });

  it("user A's export holds none of user B's data", async () => {
    const { userA, userB, footprintB } = await twoSeededUsers("isolation");

    const { text, document } = await readExport(userA);

    expect(text).not.toContain(userB.id);
    expect(text).not.toContain(userB.email);
    expect(text).not.toContain(footprintB.strategyId);
    expect(text).not.toContain(footprintB.strategyVersionId);
    for (const [table, rows] of Object.entries(document.tables)) {
      for (const row of rows) {
        if ("userId" in row) {
          expect(row.userId, table).toBe(userA.id);
        }
      }
    }
    expect(document.tables.user).toEqual([expect.objectContaining({ id: userA.id })]);
  });

  it("never exports password hashes or session tokens", async () => {
    const { userA } = await twoSeededUsers("secrets");

    const { text, document } = await readExport(userA);

    expect(text).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);
    expect(text).not.toContain("hash-");
    expect(text).not.toContain("token-");
    expect(document.tables.session?.[0]).toMatchObject({ ipAddress: "203.0.113.7" });
  });
});
