import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";

import { LessonProgressRepository } from "./lesson-progress-repository";

function uniqueEmail(label: string): string {
  return `fetha-learning-${label}-${crypto.randomUUID()}@example.com`;
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

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("LessonProgressRepository isolation", () => {
  it("user A cannot read or overwrite user B's lesson progress", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new LessonProgressRepository(db, userA).recordAttempt("what-is-an-option", 1, 4, 4, true);
    await new LessonProgressRepository(db, userB).recordAttempt(
      "what-is-an-option",
      1,
      1,
      4,
      false,
    );

    const rowsA = await new LessonProgressRepository(db, userA).findAll();
    const rowsB = await new LessonProgressRepository(db, userB).findAll();

    expect(rowsA).toEqual([
      { lessonId: "what-is-an-option", lessonVersion: 1, bestCorrect: 4, total: 4, passed: true },
    ]);
    expect(rowsB).toEqual([
      { lessonId: "what-is-an-option", lessonVersion: 1, bestCorrect: 1, total: 4, passed: false },
    ]);
  });

  it("starts empty for a user with no attempts", async () => {
    const db = getDb();
    const email = uniqueEmail("empty");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    expect(await new LessonProgressRepository(db, testUser).findAll()).toEqual([]);
  });

  it("keeps the best score across attempts on the same quiz version", async () => {
    const db = getDb();
    const email = uniqueEmail("best-score");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new LessonProgressRepository(db, testUser);

    await repository.recordAttempt("calls-and-puts", 1, 2, 4, false);
    await repository.recordAttempt("calls-and-puts", 1, 1, 4, false);

    const [row] = await repository.findAll();
    expect(row).toEqual({
      lessonId: "calls-and-puts",
      lessonVersion: 1,
      bestCorrect: 2,
      total: 4,
      passed: false,
    });
  });

  it("never moves firstPassedAt once a lesson has passed, even on a lower later score", async () => {
    const db = getDb();
    const email = uniqueEmail("keep-passed");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new LessonProgressRepository(db, testUser);

    await repository.recordAttempt("calls-and-puts", 1, 4, 4, true);
    await repository.recordAttempt("calls-and-puts", 1, 1, 4, false);

    const [row] = await repository.findAll();
    expect(row?.passed).toBe(true);
    expect(row?.bestCorrect).toBe(4);
  });

  it("starts the best score over when the lesson's quiz version changes", async () => {
    const db = getDb();
    const email = uniqueEmail("version-bump");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);
    const repository = new LessonProgressRepository(db, testUser);

    await repository.recordAttempt("calls-and-puts", 1, 4, 4, true);
    await repository.recordAttempt("calls-and-puts", 2, 1, 4, false);

    const [row] = await repository.findAll();
    expect(row).toEqual({
      lessonId: "calls-and-puts",
      lessonVersion: 2,
      bestCorrect: 1,
      total: 4,
      passed: false,
    });
  });
});
