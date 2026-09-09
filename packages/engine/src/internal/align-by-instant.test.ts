import { describe, expect, it } from "vitest";
import type { Instant } from "@fetha/contracts";
import { alignByInstant } from "./align-by-instant";

const instant = (value: string): Instant => value;

describe("alignByInstant", () => {
  it("maps each target instant to the value of the latest source instant at or before it", () => {
    const sources = [instant("2024-01-02T21:00:00.000Z"), instant("2024-01-04T21:00:00.000Z")];
    const values = ["a", "b"];
    const targets = [
      instant("2024-01-01T21:00:00.000Z"),
      instant("2024-01-02T21:00:00.000Z"),
      instant("2024-01-03T21:00:00.000Z"),
      instant("2024-01-04T21:00:00.000Z"),
      instant("2024-01-05T21:00:00.000Z"),
    ];
    expect(alignByInstant(targets, sources, values)).toEqual([null, "a", "a", "b", "b"]);
  });

  it("is null for every target before the first source instant", () => {
    expect(
      alignByInstant(
        [instant("2024-01-01T00:00:00.000Z")],
        [instant("2024-01-05T00:00:00.000Z")],
        ["x"],
      ),
    ).toEqual([null]);
  });

  it("returns all nulls when there are no source instants", () => {
    expect(
      alignByInstant(
        [instant("2024-01-01T00:00:00.000Z"), instant("2024-01-02T00:00:00.000Z")],
        [],
        [],
      ),
    ).toEqual([null, null]);
  });

  it("never applies a same-session point published at a later time of day to an earlier intraday target", () => {
    const sources = [instant("2024-01-02T21:00:00.000Z")];
    const values = ["closing-value"];
    const midSessionTarget = instant("2024-01-02T14:15:00.000Z");
    expect(alignByInstant([midSessionTarget], sources, values)).toEqual([null]);
  });
});
