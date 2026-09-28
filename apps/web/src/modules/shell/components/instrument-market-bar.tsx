"use client";

import { usePublishMarketBarInstrument, type MarketBarInstrument } from "./market-bar-context";

export function InstrumentMarketBar({ instrument }: { instrument: MarketBarInstrument }) {
  usePublishMarketBarInstrument(instrument);
  return null;
}
