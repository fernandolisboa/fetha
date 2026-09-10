import type { Provenance } from "../api";

// The four fields every computation stamps its own artifact with, resolved once by
// engine.ts's provenanceBaseFor and threaded through (round 1 item 12): price-operation.ts,
// mark-to-market.ts and propose-settlement.ts each declared this Pick inline.
export type ProvenanceBase = Pick<
  Provenance,
  "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
>;
