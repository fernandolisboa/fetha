import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { registerVerifiedUser } from "./registration-test-support";
import { testRequestHeaders } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.REGISTRATION_MODE = "open";

const PASSWORD = "correct-horse-battery";

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("/change-password (#145)", () => {
  it("is not served, even to its session holder with the right current password", async () => {
    const email = `fetha-change-password-${crypto.randomUUID()}@example.com`;
    createdEmails.push(email);
    await registerVerifiedUser({ name: "Holder", email, password: PASSWORD }, testRequestHeaders());
    const signInResponse = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    });
    const headers = testRequestHeaders();
    headers.set("cookie", signInResponse.headers.get("set-cookie") ?? "");
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");

    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers,
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "another-horse-battery" }),
      }),
    );

    expect(response.status).toBe(404);
    const again = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    });
    expect(again.status).toBe(200);
  });
});
