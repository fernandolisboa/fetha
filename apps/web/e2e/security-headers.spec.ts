import { expect, test } from "@playwright/test";

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
  test(`${path} stamps its script-policy nonce on every script`, async ({ request }) => {
    await request.get(path);

    const response = await request.get(path, { maxRedirects: 0 });
    const policy = response.headers()["content-security-policy-report-only"] ?? "";
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
