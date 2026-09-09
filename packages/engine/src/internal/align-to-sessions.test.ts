import { describe, expect, it } from "vitest";
import { alignToSessions } from "./align-to-sessions";

describe("alignToSessions", () => {
  it("maps each target session to the value of the latest source session at or before it", () => {
    const sourceSessions = ["2024-01-02", "2024-01-04"];
    const values = ["a", "b"];
    const targets = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    expect(alignToSessions(targets, sourceSessions, values)).toEqual([null, "a", "a", "b", "b"]);
  });

  it("is null for every target before the first source session", () => {
    expect(alignToSessions(["2024-01-01"], ["2024-01-05"], ["x"])).toEqual([null]);
  });

  it("returns all nulls when there are no source sessions", () => {
    expect(alignToSessions(["2024-01-01", "2024-01-02"], [], [])).toEqual([null, null]);
  });
});
