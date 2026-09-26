import { describe, expect, it } from "vitest";

import { readAccessContext } from "./request-context";

describe("readAccessContext", () => {
  it("prefers x-real-ip, as Better Auth does", () => {
    const headers = new Headers({
      "x-real-ip": "198.51.100.2",
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "UA",
    });
    expect(readAccessContext(headers)).toEqual({ ipAddress: "198.51.100.2", userAgent: "UA" });
  });

  it("falls back to the first x-forwarded-for hop", () => {
    const headers = new Headers({ "x-forwarded-for": " 2001:db8::1 , 10.0.0.1" });
    expect(readAccessContext(headers)).toEqual({ ipAddress: "2001:db8::1", userAgent: null });
  });

  it("stores null for a value that is not an address", () => {
    const headers = new Headers({ "x-forwarded-for": "x".repeat(4096) });
    expect(readAccessContext(headers).ipAddress).toBeNull();
  });

  it("stores nulls when the request carries neither", () => {
    expect(readAccessContext(new Headers())).toEqual({ ipAddress: null, userAgent: null });
  });

  it("cuts the user agent to 512 characters", () => {
    const headers = new Headers({ "user-agent": "x".repeat(600) });
    expect(readAccessContext(headers).userAgent).toHaveLength(512);
  });
});
