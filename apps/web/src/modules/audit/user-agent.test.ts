import { describe, expect, it } from "vitest";

import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Edge",
      "Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Chrome",
      "Windows",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      "Chrome",
      "Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari",
      "iOS",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox",
      "macOS",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/115.0.0.0",
      "Opera",
      "Linux",
    ],
  ])("reads %s", (userAgent, browser, os) => {
    expect(describeUserAgent(userAgent)).toEqual({ browser, os });
  });

  it("returns nulls for an unknown or missing agent", () => {
    expect(describeUserAgent("curl/8.9.1")).toEqual({ browser: null, os: null });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null });
  });
});
