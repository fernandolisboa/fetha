import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isAtOrBefore } from "./instant";
import { indexBySession, lastKnownRow, rowOnSession } from "./session-rows";

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
  it("rowOnSession returns rows.find()'s row for a session visible at an instant", () => {
    fc.assert(
      fc.property(rowsArbitrary, sessionArbitrary, visibleAtArbitrary, (rows, session, at) => {
        const expected =
          rows.find((row) => row.session === session && isAtOrBefore(row.asOf, at)) ?? null;
        expect(rowOnSession(indexBySession(rows), session, at)).toBe(expected);
      }),
    );
  });

  it("lastKnownRow returns the first-listed visible row of the latest session up to a date", () => {
    fc.assert(
      fc.property(rowsArbitrary, sessionArbitrary, visibleAtArbitrary, (rows, upto, at) => {
        const visible = rows.filter((row) => row.session <= upto && isAtOrBefore(row.asOf, at));
        const expected =
          visible.length === 0
            ? null
            : visible.reduce((latest, row) => (row.session > latest.session ? row : latest));
        expect(lastKnownRow(indexBySession(rows), upto, at)).toBe(expected);
      }),
    );
  });

  it("finds nothing for a ticker without rows", () => {
    expect(rowOnSession(undefined, "2024-01-02", "2024-01-02T20:00:00.000Z")).toBeNull();
    expect(lastKnownRow(undefined, "2024-01-02", "2024-01-02T20:00:00.000Z")).toBeNull();
  });
});
