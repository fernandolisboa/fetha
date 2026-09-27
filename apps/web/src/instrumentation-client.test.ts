import { z } from "zod";
import { describe, expect, it } from "vitest";

describe("client instrumentation", () => {
  it("turns off Zod's eval probe before any schema runs", async () => {
    await import("./instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });
});
