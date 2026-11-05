import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

function request(url: string) {
  return unstable_getResponseFromNextConfig({ url, nextConfig });
}

describe("legacy production host", () => {
  it.each([
    ["https://fetha.vercel.app/", "https://fetha.filx.app/"],
    ["https://fetha.vercel.app/entrar", "https://fetha.filx.app/entrar"],
    [
      "https://fetha.vercel.app/estrategias/abc/backtests/def?aba=resumo",
      "https://fetha.filx.app/estrategias/abc/backtests/def?aba=resumo",
    ],
    [
      "https://fetha.vercel.app/api/auth/magic-link/verify?token=t",
      "https://fetha.filx.app/api/auth/magic-link/verify?token=t",
    ],
    ["https://fetha.vercel.app/api/cronograma", "https://fetha.filx.app/api/cronograma"],
  ])("sends %s to %s with a permanent redirect", async (from, to) => {
    const response = await request(from);
    expect(response.status).toBe(308);
    expect(getRedirectUrl(response)).toBe(to);
  });

  // Vercel Cron does not follow redirects (vercel.com/docs/cron-jobs/manage-cron-jobs), so a
  // redirected invocation would end before the handler ran, unlogged and not retried.
  it.each(["https://fetha.vercel.app/api/cron/ingest", "https://fetha.vercel.app/api/cron"])(
    "leaves the cron route %s on the legacy host",
    async (url) => {
      const response = await request(url);
      expect(getRedirectUrl(response)).toBeNull();
    },
  );

  it.each([
    "https://fetha.filx.app/entrar",
    "https://fetha-git-branch-flisboa-projects.vercel.app/entrar",
    "http://localhost:3000/entrar",
  ])("serves %s in place", async (url) => {
    const response = await request(url);
    expect(getRedirectUrl(response)).toBeNull();
  });
});
