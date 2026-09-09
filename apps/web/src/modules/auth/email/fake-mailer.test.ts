import { describe, expect, it } from "vitest";

import { FakeMailer } from "./fake-mailer";

describe("FakeMailer", () => {
  it("records every send without performing I/O", async () => {
    const mailer = new FakeMailer();
    await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });
    expect(mailer.sent).toEqual([
      { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" },
    ]);
  });
});
