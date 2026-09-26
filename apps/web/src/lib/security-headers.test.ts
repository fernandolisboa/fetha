import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const matching = rules.filter((rule) =>
    new RegExp(buildCustomRoute("header", rule).regex).test(path),
  );
  return new Map(matching.flatMap((rule) => rule.headers.map((h) => [h.key, h.value])));
}

describe("security headers", () => {
  it.each(["/", "/entrar", "/carteira", "/api/auth/get-session", "/sw.js"])(
    "are sent on %s",
    async (path) => {
      const headers = await headersFor(path);
      expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.get("Permissions-Policy")).toContain("camera=()");
    },
  );

  it("does not restrict scripts or styles yet, so Next's inline bootstrap keeps working", async () => {
    const csp = (await headersFor("/")).get("Content-Security-Policy") ?? "";
    expect(csp).not.toMatch(/(?:default|script|style)-src/);
  });
});
