import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isAtOrBefore } from "./instant";
import { indexBySession, lastKnownRow, rowOnSession } from "./session-rows";
import { latestVisible } from "./visible";

type Row = { id: number; session: string; asOf: string };

const sessions = ["2024-01-02", "2024-01-03", "2024-01-04"];

// A row is published at its own session's close or restated at a later session's close.
const rowsArbitrary = fc
  .array(
    fc.record({
      session: fc.constantFrom(...sessions),
      publishedOn: fc.constantFrom(...sessions),
    }),
    { maxLength: 10 },
  )
  .map((rows) =>
    rows.map(({ session, publishedOn }, id): Row => ({
      id,
      session,
      asOf: `${publishedOn > session ? publishedOn : session}T20:00:00.000Z`,
    })),
  );

const sessionArbitrary = fc.constantFrom("2024-01-01", ...sessions, "2024-01-05");
const visibleAtArbitrary = fc.constantFrom(...sessions.map((s) => `${s}T20:00:00.000Z`));

describe("session-rows (#58)", () => {
  // A restated row replaces the earlier one from its asOf on (#38): the latest version visible
  // at the instant, whatever the input order.
  it("rowOnSession returns the latest version of a session visible at an instant", () => {
    fc.assert(
      fc.property(rowsArbitrary, sessionArbitrary, visibleAtArbitrary, (rows, session, at) => {
        const expected = latestVisible(
          rows.filter((row) => row.session === session),
          at,
        );
        expect(rowOnSession(indexBySession(rows), session, at)).toBe(expected);
      }),
    );
  });

  it("lastKnownRow returns the latest visible version of the latest session up to a date", () => {
    fc.assert(
      fc.property(rowsArbitrary, sessionArbitrary, visibleAtArbitrary, (rows, upto, at) => {
        const visible = rows.filter((row) => row.session <= upto && isAtOrBefore(row.asOf, at));
        const latestSession = visible.reduce<string | null>(
          (latest, row) => (latest === null || row.session > latest ? row.session : latest),
          null,
        );
        const expected = latestVisible(
          visible.filter((row) => row.session === latestSession),
          at,
        );
        expect(lastKnownRow(indexBySession(rows), upto, at)).toBe(expected);
      }),
    );
  });

  it("reads a restatement from its asOf on, and the earlier version before it", () => {
    const original = { id: 0, session: "2024-01-02", asOf: "2024-01-02T20:00:00.000Z" };
    const restated = { id: 1, session: "2024-01-02", asOf: "2024-01-03T20:00:00.000Z" };
    for (const rows of [
      [original, restated],
      [restated, original],
    ]) {
      const index = indexBySession(rows);
      expect(rowOnSession(index, "2024-01-02", "2024-01-02T22:00:00.000Z")).toBe(original);
      expect(rowOnSession(index, "2024-01-02", "2024-01-03T20:00:00.000Z")).toBe(restated);
      expect(lastKnownRow(index, "2024-01-04", "2024-01-04T20:00:00.000Z")).toBe(restated);
    }
  });

  it("finds nothing for a ticker without rows", () => {
    expect(rowOnSession(undefined, "2024-01-02", "2024-01-02T20:00:00.000Z")).toBeNull();
    expect(lastKnownRow(undefined, "2024-01-02", "2024-01-02T20:00:00.000Z")).toBeNull();
  });
});
