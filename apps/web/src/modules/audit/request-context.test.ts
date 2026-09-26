import { describe, expect, it } from "vitest";

import { readAccessContext } from "./request-context";

describe("readAccessContext", () => {
  it("takes the first x-forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.7 , 10.0.0.1",
      "user-agent": "UA",
    });
    expect(readAccessContext(headers)).toEqual({ ipAddress: "203.0.113.7", userAgent: "UA" });
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.2" });
    expect(readAccessContext(headers)).toEqual({ ipAddress: "198.51.100.2", userAgent: null });
  });

  it("stores nulls when the request carries neither", () => {
    expect(readAccessContext(new Headers())).toEqual({ ipAddress: null, userAgent: null });
  });

  it("cuts the user agent to 512 characters", () => {
    const headers = new Headers({ "user-agent": "x".repeat(600) });
    expect(readAccessContext(headers).userAgent).toHaveLength(512);
  });
});
