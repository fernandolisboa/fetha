import type { DecimalString } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { toneDomain, toneTick } from "./components/news-tone-chart";
import { averageTone, toneCounts } from "./sentiment-summary";

const point = (day: string, tone: string, articles: number) => ({
  day,
  tone: tone as DecimalString,
  articles,
});

describe("toneCounts", () => {
  it("counts each tone", () => {
    expect(toneCounts(["positive", "negative", "positive"])).toEqual({
      positive: 2,
      neutral: 0,
      negative: 1,
    });
  });
});

describe("averageTone", () => {
  it("weights each day by its article count, from the start day on", () => {
    expect(
      averageTone(
        [
          point("2026-09-01", "9.0000", 100),
          point("2026-10-01", "-2.0000", 1),
          point("2026-10-02", "1.0000", 3),
          point("2026-10-03", "0.0000", 0),
        ],
        "2026-09-13",
      ),
    ).toEqual({ tone: "0.2500", articles: 4 });
  });

  it("has no average without articles", () => {
    expect(averageTone([point("2026-10-03", "0.0000", 0)], "2026-09-13")).toBeNull();
    expect(averageTone([], "2026-09-13")).toBeNull();
  });
});

describe("news tone chart scale", () => {
  it("is symmetric around zero, at least one unit wide, over days with articles", () => {
    expect(toneDomain([])).toEqual([-1, 1]);
    expect(
      toneDomain([
        { day: "d", tone: "0.4", articles: 3 },
        { day: "e", tone: "-3.25", articles: 1 },
        { day: "f", tone: "-9", articles: 0 },
      ]),
    ).toEqual([-3.25, 3.25]);
  });

  it("labels ticks the Brazilian way with a true minus sign", () => {
    expect(toneTick(-0.5)).toBe("−0,5");
    expect(toneTick(2)).toBe("2");
    expect(toneTick(0)).toBe("0");
  });
});
