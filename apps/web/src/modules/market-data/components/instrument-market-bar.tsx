"use client";

import { usePublishMarketBarInstrument, type MarketBarInstrument } from "@/modules/shell/client";

export function InstrumentMarketBar({ instrument }: { instrument: MarketBarInstrument }) {
  usePublishMarketBarInstrument(instrument);
  return null;
}
