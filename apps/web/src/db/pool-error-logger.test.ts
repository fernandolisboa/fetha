import { describe, expect, it, vi } from "vitest";

import { attachPoolErrorLogger, type PoolLike } from "./pool-error-logger";

describe("attachPoolErrorLogger", () => {
  it("logs the error name and code without leaking the error object", () => {
    let handler: ((error: unknown) => void) | undefined;
    const pool: PoolLike = {
      on: (_event, listener) => {
        handler = listener;
        return pool;
      },
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    attachPoolErrorLogger(pool);
    handler?.(Object.assign(new Error("boom"), { code: "ECONNRESET" }));

    expect(consoleSpy).toHaveBeenCalledWith("Neon pool error", {
      name: "Error",
      code: "ECONNRESET",
    });
    consoleSpy.mockRestore();
  });

  it("falls back to defaults for non-Error values", () => {
    let handler: ((error: unknown) => void) | undefined;
    const pool: PoolLike = {
      on: (_event, listener) => {
        handler = listener;
        return pool;
      },
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    attachPoolErrorLogger(pool);
    handler?.("not an error");

    expect(consoleSpy).toHaveBeenCalledWith("Neon pool error", {
      name: "Error",
      code: undefined,
    });
    consoleSpy.mockRestore();
  });
});
