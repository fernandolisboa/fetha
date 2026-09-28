import { expect, test } from "./tour";

for (const path of ["/", "/entrar"]) {
  test(`${path} is sent with the security headers`, async ({ request }) => {
    // On a protected preview the first response is Vercel's own redirect that
    // sets the bypass cookie (playwright.config.ts), not the app's response.
    await request.get(path);

    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });
}

for (const path of ["/entrar", "/cadastro"]) {
  test(`${path} stamps the policy's nonce on every script`, async ({ request }) => {
    await request.get(path);

    const response = await request.get(path, {
      maxRedirects: 0,
      headers: { "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='" },
    });
    const policy = response.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(policy).toContain("'strict-dynamic'");

    const scripts = (await response.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script).toContain(`nonce="${nonce ?? ""}"`);
    }
  });
}

for (const path of ["/entrar", "/cadastro", "/link-magico", "/redefinir-senha", "/termos"]) {
  test(`${path} runs without a policy violation`, async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { cspViolations: seen });
      document.addEventListener("securitypolicyviolation", (event) => {
        seen.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    await page.goto(path);
    await page.waitForLoadState("networkidle");

    expect(
      await page.evaluate(() => (window as { cspViolations?: string[] }).cspViolations),
    ).toEqual([]);
  });
}
