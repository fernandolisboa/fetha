import { describe, expect, it } from "vitest";

import { buildPasswordResetEmail } from "./password-reset-email";

describe("buildPasswordResetEmail", () => {
  it("includes the reset url in the text body", () => {
    const email = buildPasswordResetEmail("https://fetha.app/redefinir-senha/confirmar?token=abc");
    expect(email.text).toContain("https://fetha.app/redefinir-senha/confirmar?token=abc");
  });

  it("includes the reset url in the html body", () => {
    const email = buildPasswordResetEmail("https://fetha.app/redefinir-senha/confirmar?token=abc");
    expect(email.html).toContain("https://fetha.app/redefinir-senha/confirmar?token=abc");
  });

  it("tells the recipient to ignore the email if they didn't request it", () => {
    const email = buildPasswordResetEmail("https://fetha.app/");
    expect(email.text).toContain("Se você não pediu essa redefinição, ignore este e-mail.");
    expect(email.html).toContain("Se você não pediu essa redefinição, ignore este e-mail.");
  });
});
