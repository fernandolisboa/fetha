import { afterEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const createClientMock = vi.fn(() => ({ get: getMock }));

vi.mock("@vercel/global-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/global-config")>();
  return { ...actual, createClient: createClientMock };
});

const { createRuntimeSettings } = await import("./runtime-settings");

const CONNECTION_STRING = "https://global-config.vercel.com/ecfg_test?token=tok_test";

afterEach(() => {
  getMock.mockReset();
  createClientMock.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createRuntimeSettings", () => {
  it("reads nothing when GLOBAL_CONFIG is unset or empty", async () => {
    expect(await createRuntimeSettings({}).read("registration_mode")).toBeUndefined();
    expect(
      await createRuntimeSettings({ GLOBAL_CONFIG: "" }).read("registration_mode"),
    ).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("logs and reads nothing when GLOBAL_CONFIG is not a connection string", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const settings = createRuntimeSettings({ GLOBAL_CONFIG: "not-a-connection-string" });

    expect(await settings.read("registration_mode")).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "GLOBAL_CONFIG is not a valid Global Config connection string; ignoring it",
    );
  });

  it("returns the stored value for a key without serving stale values on upstream errors", async () => {
    getMock.mockResolvedValueOnce("open");

    const settings = createRuntimeSettings({ GLOBAL_CONFIG: CONNECTION_STRING });

    expect(await settings.read("registration_mode")).toBe("open");
    expect(getMock).toHaveBeenCalledWith("registration_mode");
    expect(createClientMock).toHaveBeenCalledWith(CONNECTION_STRING, { staleIfError: false });
  });

  it("returns undefined and logs only the error name when the store read fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getMock.mockRejectedValueOnce(new Error("token=secret leaked"));

    const settings = createRuntimeSettings({ GLOBAL_CONFIG: CONNECTION_STRING });

    expect(await settings.read("registration_mode")).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith("Global Config read failed", {
      key: "registration_mode",
      name: "Error",
    });
  });

  it("gives up on a read that hangs and falls back to undefined", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getMock.mockReturnValueOnce(new Promise(() => undefined));

    const settings = createRuntimeSettings({ GLOBAL_CONFIG: CONNECTION_STRING });
    const pending = settings.read("registration_mode");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await pending).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith("Global Config read failed", {
      key: "registration_mode",
      name: "Error",
    });
  });
});
