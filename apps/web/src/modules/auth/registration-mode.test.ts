import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import type { RuntimeSettings } from "@/lib/runtime-settings";
import { REGISTRATION_MODE_SETTING, resolveRegistrationMode } from "./registration-mode";

function settingsWith(value: unknown): RuntimeSettings {
  return {
    read: vi.fn((key: string) =>
      Promise.resolve(key === REGISTRATION_MODE_SETTING ? value : undefined),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveRegistrationMode", () => {
  it("prefers a valid stored value over the environment variable", async () => {
    expect(
      await resolveRegistrationMode(settingsWith("open"), { REGISTRATION_MODE: "closed" }),
    ).toBe("open");
  });

  it("does not consult the environment variable when the store decides", async () => {
    expect(
      await resolveRegistrationMode(settingsWith("closed"), { REGISTRATION_MODE: "garbage" }),
    ).toBe("closed");
  });

  it("prefers a stored value regardless of case", async () => {
    expect(
      await resolveRegistrationMode(settingsWith("OPEN"), { REGISTRATION_MODE: "closed" }),
    ).toBe("open");
  });

  it("prefers a stored value with surrounding whitespace", async () => {
    expect(
      await resolveRegistrationMode(settingsWith(" closed "), { REGISTRATION_MODE: "open" }),
    ).toBe("closed");
  });

  it("falls back to the environment variable when the store has no value", async () => {
    expect(
      await resolveRegistrationMode(settingsWith(undefined), { REGISTRATION_MODE: "open" }),
    ).toBe("open");
  });

  it("treats a stored null as unset", async () => {
    expect(await resolveRegistrationMode(settingsWith(null), { REGISTRATION_MODE: "closed" })).toBe(
      "closed",
    );
  });

  it("treats a stored empty string as unset", async () => {
    expect(await resolveRegistrationMode(settingsWith(""), { REGISTRATION_MODE: "closed" })).toBe(
      "closed",
    );
  });

  it("falls back to the default when neither the store nor the environment sets a mode", async () => {
    expect(await resolveRegistrationMode(settingsWith(undefined), {})).toBe("invite");
  });

  it("is case- and whitespace-insensitive on the environment variable too", async () => {
    expect(
      await resolveRegistrationMode(settingsWith(undefined), { REGISTRATION_MODE: " Open " }),
    ).toBe("open");
  });

  it("ignores an invalid short stored string, logs its type and value and falls back to the environment", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      await resolveRegistrationMode(settingsWith("opne"), { REGISTRATION_MODE: "closed" }),
    ).toBe("closed");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "registration_mode setting ignored: invalid value",
      { type: "string", value: "opne" },
    );
  });

  it("logs only the type and length of a stored string longer than the threshold, never its content", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const longValue = "a".repeat(50);

    expect(
      await resolveRegistrationMode(settingsWith(longValue), { REGISTRATION_MODE: "closed" }),
    ).toBe("closed");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "registration_mode setting ignored: invalid value",
      { type: "string", length: 50 },
    );
  });

  it("ignores a non-string stored value, logs its type only and falls back to the environment", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      await resolveRegistrationMode(settingsWith({ mode: "open" }), {
        REGISTRATION_MODE: "closed",
      }),
    ).toBe("closed");
    expect(await resolveRegistrationMode(settingsWith(42), { REGISTRATION_MODE: "closed" })).toBe(
      "closed",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "registration_mode setting ignored: invalid value",
      { type: "object" },
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "registration_mode setting ignored: invalid value",
      { type: "number" },
    );
  });

  it("still rejects an invalid environment value when the store is silent", async () => {
    await expect(
      resolveRegistrationMode(settingsWith(undefined), { REGISTRATION_MODE: "public" }),
    ).rejects.toThrow(ZodError);
  });
});
