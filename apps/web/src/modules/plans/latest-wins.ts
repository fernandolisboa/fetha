// Drag-to-adjust fires an `adjustPlanAction` round trip on every release, lot step and expiry
// chip (ticket #380); two of those can resolve out of order (a slow one from an earlier edit
// landing after a faster one from a later edit). This is the reconciliation rule between the
// client's own instant preview and the server's official reply: only the response to the latest
// request issued ever replaces what is on screen, so a stale reply can never un-apply a newer
// edit the user already made.
export class LatestRequestWins {
  private latest = 0;

  issue(): number {
    this.latest += 1;
    return this.latest;
  }

  isCurrent(id: number): boolean {
    return id === this.latest;
  }
}
