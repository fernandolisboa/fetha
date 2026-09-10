"use client";

// A direct, file-level import rather than the shell module's barrel
// (`@/modules/shell`): that barrel also re-exports AppShell's server-only
// account menu (which reaches `next/headers`), and importing it from this
// client component would pull that whole graph into the client bundle.
import {
  usePublishMarketBarInstrument,
  type MarketBarInstrument,
} from "@/modules/shell/components/market-bar-context";

export function InstrumentMarketBar({ instrument }: { instrument: MarketBarInstrument }) {
  usePublishMarketBarInstrument(instrument);
  return null;
}
