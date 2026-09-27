import { APIError } from "better-auth/api";
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

async function signedInHolder(): Promise<{ email: string; headers: Headers }> {
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
  return { email, headers };
}

async function stillSignsIn(email: string): Promise<number> {
  const response = await getAuth().api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  return response.status;
}

describe("password oracles for a session holder (#145)", () => {
  it.each([
    ["/change-password", { currentPassword: PASSWORD, newPassword: "another-horse-battery" }],
    [
      "/change-password",
      { currentPassword: "a-wrong-guess", newPassword: "another-horse-battery" },
    ],
    ["/verify-password", { password: PASSWORD }],
    ["/verify-password", { password: "a-wrong-guess" }],
  ])("%s is not served over HTTP, whatever the password", async (path, body) => {
    const { email, headers } = await signedInHolder();

    const response = await getAuth().handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(404);
    expect(await stillSignsIn(email)).toBe(200);
  });

  it("is not served through the server API either", async () => {
    const { email, headers } = await signedInHolder();

    const call = getAuth().api.changePassword({
      body: { currentPassword: PASSWORD, newPassword: "another-horse-battery" },
      headers,
    });

    await expect(call).rejects.toSatisfy(
      (error: unknown) => error instanceof APIError && error.statusCode === 404,
    );
    expect(await stillSignsIn(email)).toBe(200);
  });
});
