export interface LotSizingResult {
  // false when even one lot's max loss already exceeds the limit: the plan then says it cannot
  // fit (ticket #379) instead of silently sizing to zero lots.
  fits: boolean;
  lots: number;
  maxLossCentavos: number;
}

// Sizes an operation in lots of 100 (docs/adr/0067's standard lot), the plan's own cap on how far
// it ever prices (ticket #379, round 1 review: one shared constant, not a magic number repeated
// at every caller).
export const MAX_LOTS_SEARCHED = 50;

// Sizes an operation to the largest lot count whose max loss still fits the risk profile's
// per-operation limit, pricing one candidate lot at a time and stopping at the first one that
// does not fit, rather than eagerly pricing every lot up to the cap (round 1 review). `maxLossForLots`
// prices one candidate lot count against the engine; it resolves to null when that size is
// unpriceable.
export async function chooseLotSize(
  maxLossForLots: (lots: number) => Promise<number | null>,
  maxLossLimitCentavos: number,
): Promise<LotSizingResult | null> {
  const oneLot = await maxLossForLots(1);
  if (oneLot === null) return null;
  if (oneLot > maxLossLimitCentavos) return { fits: false, lots: 1, maxLossCentavos: oneLot };

  let bestLots = 1;
  let bestMaxLoss = oneLot;
  for (let lots = 2; lots <= MAX_LOTS_SEARCHED; lots += 1) {
    const maxLoss = await maxLossForLots(lots);
    if (maxLoss === null || maxLoss > maxLossLimitCentavos) break;
    bestLots = lots;
    bestMaxLoss = maxLoss;
  }
  return { fits: true, lots: bestLots, maxLossCentavos: bestMaxLoss };
}
