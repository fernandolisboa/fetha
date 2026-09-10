"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@fetha/engine";

function resolvedToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// lightweight-charts draws on a canvas: it needs resolved color strings and
// plain numbers, not decimal.js values or CSS `var()` references (a canvas
// 2D context does not resolve custom properties). This stays a pure
// rendering boundary; no price arithmetic happens here (CLAUDE.md's
// decimal-only rule governs computation, not pixel placement).
function toChartTime(session: string): UTCTimestamp {
  return (new Date(`${session}T00:00:00Z`).getTime() / 1000) as UTCTimestamp;
}

export function CandleChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const up = resolvedToken("--up");
    const down = resolvedToken("--down");
    const line = resolvedToken("--line");
    const lineSoft = resolvedToken("--line-soft");
    const muted = resolvedToken("--muted");

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: muted },
      grid: { vertLines: { color: lineSoft }, horzLines: { color: lineSoft } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
    });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    candleSeries.setData(
      candles.map((candle) => ({
        time: toChartTime(candle.session),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      })),
    );
    volumeSeries.setData(
      candles.map((candle) => ({
        time: toChartTime(candle.session),
        value: candle.tradedQuantity,
        color: Number(candle.close) >= Number(candle.open) ? up : down,
      })),
    );

    return () => {
      chart.remove();
    };
  }, [candles]);

  return <div ref={containerRef} className="h-[420px] w-full" />;
}
