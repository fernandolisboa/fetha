import { Decimal } from "decimal.js";
import type { DecimalString, FilingTone } from "@fetha/contracts";

import type { NewsTonePoint } from "./repositories/news-repository";

export type ToneCounts = Record<FilingTone, number>;

export function toneCounts(tones: readonly FilingTone[]): ToneCounts {
  const counts: ToneCounts = { positive: 0, neutral: 0, negative: 0 };
  for (const tone of tones) {
    counts[tone] += 1;
  }
  return counts;
}

export interface AverageTone {
  tone: DecimalString;
  articles: number;
}

// GDELT's daily tone weighted by that day's article count, over the days on
// or after `since` (docs/adr/0065): a day with one article must not move the
// average as much as a day with fifty.
export function averageTone(points: readonly NewsTonePoint[], since: string): AverageTone | null {
  let weighted = new Decimal(0);
  let articles = 0;
  for (const point of points) {
    if (point.day < since || point.articles === 0) {
      continue;
    }
    weighted = weighted.plus(new Decimal(point.tone).times(point.articles));
    articles += point.articles;
  }
  if (articles === 0) {
    return null;
  }
  return { tone: weighted.dividedBy(articles).toFixed(4) as DecimalString, articles };
}
