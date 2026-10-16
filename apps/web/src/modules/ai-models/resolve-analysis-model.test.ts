import { describe, expect, it } from "vitest";

import { resolveAnalysisModelPolicy, resolveListingKey } from "./resolve-analysis-model";

describe("resolveAnalysisModelPolicy", () => {
  it("prefers a readable own key over the server key", () => {
    const result = resolveAnalysisModelPolicy({
      serverKey: "sk-server",
      ownKey: { status: "ok", key: "sk-own" },
      families: {},
      kind: "signal",
    });
    expect(result).toEqual({
      status: "ok",
      apiKey: "sk-own",
      listingKey: "sk-server",
      family: "sonnet",
    });
  });

  it("falls back to the server key when there is no own key", () => {
    const result = resolveAnalysisModelPolicy({
      serverKey: "sk-server",
      ownKey: { status: "none" },
      families: {},
      kind: "signal",
    });
    expect(result).toEqual({
      status: "ok",
      apiKey: "sk-server",
      listingKey: "sk-server",
      family: "sonnet",
    });
  });

  it("answers unavailable when neither key is present", () => {
    const result = resolveAnalysisModelPolicy({
      serverKey: undefined,
      ownKey: { status: "none" },
      families: {},
      kind: "signal",
    });
    expect(result).toEqual({ status: "unavailable" });
  });

  it("answers own_key_unreadable when the stored key no longer decrypts, even with a server key", () => {
    const result = resolveAnalysisModelPolicy({
      serverKey: "sk-server",
      ownKey: { status: "unreadable" },
      families: {},
      kind: "signal",
    });
    expect(result).toEqual({ status: "own_key_unreadable" });
  });

  it("uses the stored family override over the kind's default", () => {
    const result = resolveAnalysisModelPolicy({
      serverKey: "sk-server",
      ownKey: { status: "none" },
      families: { signal: "opus" },
      kind: "signal",
    });
    expect(result).toMatchObject({ status: "ok", family: "opus" });
  });

  it("uses the own key as the listing key when there is no server key", () => {
    const result = resolveAnalysisModelPolicy({
      serverKey: undefined,
      ownKey: { status: "ok", key: "sk-own" },
      families: {},
      kind: "signal",
    });
    expect(result).toMatchObject({ status: "ok", listingKey: "sk-own" });
  });
});

describe("resolveListingKey", () => {
  it("prefers the server key for listing even when an own key is present", () => {
    expect(resolveListingKey("sk-server", { status: "ok", key: "sk-own" })).toBe("sk-server");
  });

  it("falls back to a readable own key when there is no server key", () => {
    expect(resolveListingKey(undefined, { status: "ok", key: "sk-own" })).toBe("sk-own");
  });

  it("answers undefined when neither key is usable for listing", () => {
    expect(resolveListingKey(undefined, { status: "none" })).toBeUndefined();
    expect(resolveListingKey(undefined, { status: "unreadable" })).toBeUndefined();
  });
});
