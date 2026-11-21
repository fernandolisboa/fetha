import { describe, expect, it } from "vitest";

import { LatestRequestWins } from "./latest-wins";

describe("LatestRequestWins", () => {
  it("accepts the only request issued so far", () => {
    const sequencer = new LatestRequestWins();
    const id = sequencer.issue();
    expect(sequencer.isCurrent(id)).toBe(true);
  });

  it("rejects a stale request once a newer one was issued", () => {
    const sequencer = new LatestRequestWins();
    const first = sequencer.issue();
    const second = sequencer.issue();
    expect(sequencer.isCurrent(first)).toBe(false);
    expect(sequencer.isCurrent(second)).toBe(true);
  });

  it("rejects every request once a newer one overtakes it, in arrival order", () => {
    const sequencer = new LatestRequestWins();
    const ids = [sequencer.issue(), sequencer.issue(), sequencer.issue()];
    expect(ids.map((id) => sequencer.isCurrent(id))).toEqual([false, false, true]);
  });
});
