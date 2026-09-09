import { describe, expect, it } from "vitest";

import { buildVerificationEmail } from "./verification-email";

describe("buildVerificationEmail", () => {
  it("interpolates the name and url in the text body", () => {
    const email = buildVerificationEmail("Nova User", "https://fetha.app/verify?token=abc");
    expect(email.text).toContain("Nova User");
    expect(email.text).toContain("https://fetha.app/verify?token=abc");
  });

  it("escapes markup characters in the name for the html body", () => {
    const email = buildVerificationEmail('<script>alert("x")</script>', "https://fetha.app/");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
