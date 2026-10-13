"use client";

import { useEffect, useRef } from "react";
import { createChart, LineSeries, type UTCTimestamp } from "lightweight-charts";

import type { ExchangeRateRow } from "../repositories/exchange-rate-repository";

function resolvedToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Same canvas-rendering boundary as CandleChart: lightweight-charts needs
// resolved color strings and plain numbers, never decimal.js values or CSS
// `var()` references. No price arithmetic happens here.
function toChartTime(date: string): UTCTimestamp {
  return (new Date(`${date}T00:00:00Z`).getTime() / 1000) as UTCTimestamp;
}

export function RateLineChart({ points }: { points: ExchangeRateRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const stroke = resolvedToken("--chart-stroke");
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

    const series = chart.addSeries(LineSeries, { color: stroke, lineWidth: 2 });
    series.setData(
      points.map((point) => ({ time: toChartTime(point.date), value: Number(point.rate) })),
    );

    return () => {
      chart.remove();
    };
  }, [points]);

  return <div ref={containerRef} className="h-[360px] w-full" />;
}
