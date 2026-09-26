import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VerifyEmailPage from "./page";

async function render(email: string | undefined): Promise<string> {
  const page = await VerifyEmailPage({ searchParams: Promise.resolve({ email }) });
  return renderToStaticMarkup(createElement(() => page));
}

describe("/verificar-email", () => {
  it("echoes a valid email and prefills the resend form with it", async () => {
    const html = await render("user@example.com");
    expect(html).toContain("user@example.com. ");
    expect(html).toContain('value="user@example.com"');
  });

  it("renders neither the sentence nor a prefilled value when the param is not an email", async () => {
    const bait = "Sua conta foi bloqueada. Ligue para 0800";
    const html = await render(bait);
    expect(html).not.toContain("Sua conta foi bloqueada");
    expect(html).not.toMatch(/value="/);
  });
});
