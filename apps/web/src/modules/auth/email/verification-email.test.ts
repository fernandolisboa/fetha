import { describe, expect, it } from "vitest";

import { buildVerificationEmail } from "./verification-email";

describe("buildVerificationEmail", () => {
  it("puts the url in both bodies", () => {
    const email = buildVerificationEmail("https://fetha.app/verify?token=abc");
    expect(email.text).toContain("https://fetha.app/verify?token=abc");
    expect(email.html).toContain('href="https://fetha.app/verify?token=abc"');
  });

  it("escapes markup characters in the url for the html body", () => {
    const email = buildVerificationEmail('https://fetha.app/?a="><script>');
    expect(email.html).not.toContain("<script>");
  });

  it("carries no text chosen by whoever signed up", () => {
    const email = buildVerificationEmail("https://fetha.app/verify?token=abc");
    expect(email.text).not.toContain("{name}");
    expect(email.html).not.toContain("{name}");
    expect(email.text.split("\n")[0]).toBe(
      "Olá! Confirme seu e-mail para começar a usar o Fetha: https://fetha.app/verify?token=abc",
    );
  });

  it("tells the recipient to ignore the email if they didn't create the account", () => {
    const email = buildVerificationEmail("https://fetha.app/verify?token=abc");
    expect(email.text).toContain("Se você não criou esta conta, ignore este e-mail.");
    expect(email.html).toContain("Se você não criou esta conta, ignore este e-mail.");
  });
});
