import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { registerVerifiedUser } from "./registration-test-support";
import { testRequestHeaders } from "./test-support";

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
  const session = await getAuth().api.getSession({ headers });
  expect(session?.user.email).toBe(email);
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

  it.each([
    [
      "changePassword",
      (headers: Headers) =>
        getAuth().api.changePassword({
          body: { currentPassword: PASSWORD, newPassword: "another-horse-battery" },
          headers,
        }),
    ],
    [
      "verifyPassword",
      (headers: Headers) => getAuth().api.verifyPassword({ body: { password: PASSWORD }, headers }),
    ],
  ])("auth.api.%s is not served either", async (_name, call) => {
    const { email, headers } = await signedInHolder();

    await expect(call(headers)).rejects.toSatisfy(
      (error: unknown) => error instanceof APIError && error.statusCode === 404,
    );
    expect(await stillSignsIn(email)).toBe(200);
  });
});
