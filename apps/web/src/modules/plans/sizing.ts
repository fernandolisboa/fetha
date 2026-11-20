export interface LotSizingResult {
  // false when even one lot's max loss already exceeds the limit: the plan then says it cannot
  // fit (ticket #379) instead of silently sizing to zero lots.
  fits: boolean;
  lots: number;
  maxLossCentavos: number;
}

const MAX_LOTS_SEARCHED = 50;

// Sizes an operation in lots of 100 (docs/adr/0067's standard lot) to the largest size whose max
// loss still fits the risk profile's per-operation limit. `maxLossForLots` prices one candidate
// lot count; it returns null when that size is unpriceable.
export function chooseLotSize(
  maxLossForLots: (lots: number) => number | null,
  maxLossLimitCentavos: number,
): LotSizingResult | null {
  const oneLot = maxLossForLots(1);
  if (oneLot === null) return null;
  if (oneLot > maxLossLimitCentavos) return { fits: false, lots: 1, maxLossCentavos: oneLot };

  let bestLots = 1;
  let bestMaxLoss = oneLot;
  for (let lots = 2; lots <= MAX_LOTS_SEARCHED; lots += 1) {
    const maxLoss = maxLossForLots(lots);
    if (maxLoss === null || maxLoss > maxLossLimitCentavos) break;
    bestLots = lots;
    bestMaxLoss = maxLoss;
  }
  return { fits: true, lots: bestLots, maxLossCentavos: bestMaxLoss };
}
