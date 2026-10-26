export interface Visibility {
  intersectionRatio: number;
  intersectionHeight: number;
  viewportHeight: number | null;
}

// docs/adr/0074: half of the card on screen, or half of the screen filled by a card too tall to
// ever show half of itself at once (the suggestion's own page on a phone).
export function countsAsSeen({
  intersectionRatio,
  intersectionHeight,
  viewportHeight,
}: Visibility): boolean {
  if (intersectionRatio >= 0.5) return true;
  return viewportHeight !== null && viewportHeight > 0 && intersectionHeight >= viewportHeight / 2;
}

// Every tenth, so a card is reported again as it crosses the half mark either way.
export const SEEN_THRESHOLDS = Array.from({ length: 11 }, (_, index) => index / 10);
