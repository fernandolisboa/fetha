"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface MarketBarInstrument {
  ticker: string;
  lastClose: string;
  freshness: string;
}

interface MarketBarContextValue {
  instrument: MarketBarInstrument | null;
  setInstrument: (instrument: MarketBarInstrument | null) => void;
}

const MarketBarContext = createContext<MarketBarContextValue | null>(null);

// The market bar is a header fixture (DESIGN.md: "the focused instrument's
// last price ... data freshness") fed by whatever page is currently open,
// several DOM levels below the header. A page in any module publishes its
// instrument here; it never reaches into the shell's own state.
export function MarketBarProvider({ children }: { children: ReactNode }) {
  const [instrument, setInstrument] = useState<MarketBarInstrument | null>(null);
  const value = useMemo(() => ({ instrument, setInstrument }), [instrument]);
  return <MarketBarContext.Provider value={value}>{children}</MarketBarContext.Provider>;
}

function useMarketBarContext(): MarketBarContextValue {
  const context = useContext(MarketBarContext);
  if (!context) {
    throw new Error("useMarketBarContext must be used within a MarketBarProvider");
  }
  return context;
}

export function useMarketBarInstrument(): MarketBarInstrument | null {
  return useMarketBarContext().instrument;
}

export function usePublishMarketBarInstrument(instrument: MarketBarInstrument | null): void {
  const { setInstrument } = useMarketBarContext();
  useEffect(() => {
    setInstrument(instrument);
    return () => {
      setInstrument(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per navigated instrument, not per render
  }, [instrument?.ticker, instrument?.lastClose, instrument?.freshness]);
}
