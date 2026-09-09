import { describe, expect, it } from "vitest";

import { buildMagicLinkEmail } from "./magic-link-email";

describe("buildMagicLinkEmail", () => {
  it("includes the sign-in url in the text body", () => {
    const email = buildMagicLinkEmail("https://fetha.app/api/auth/magic-link/verify?token=abc");
    expect(email.text).toContain("https://fetha.app/api/auth/magic-link/verify?token=abc");
  });

  it("includes the sign-in url in the html body", () => {
    const email = buildMagicLinkEmail("https://fetha.app/api/auth/magic-link/verify?token=abc");
    expect(email.html).toContain("https://fetha.app/api/auth/magic-link/verify?token=abc");
  });

  it("tells the recipient to ignore the email if they didn't request it", () => {
    const email = buildMagicLinkEmail("https://fetha.app/");
    expect(email.text).toContain("Se você não pediu este link, ignore este e-mail.");
    expect(email.html).toContain("Se você não pediu este link, ignore este e-mail.");
  });
});
