import {
  lessonCatalogSchema,
  lessonSchema,
  type Lesson,
  type LessonCatalog,
  type LevelId,
  type TopicId,
} from "@fetha/contracts";

import backtestHygiene from "./content/backtest-hygiene.json";
import bearCallSpread from "./content/bear-call-spread.json";
import bearPutSpread from "./content/bear-put-spread.json";
import bullCallSpread from "./content/bull-call-spread.json";
import bullPutSpread from "./content/bull-put-spread.json";
import buyingVsWriting from "./content/buying-vs-writing.json";
import callButterfly from "./content/call-butterfly.json";
import callsAndPuts from "./content/calls-and-puts.json";
import catalogJson from "./content/catalog.json";
import corporateEventsOnB3 from "./content/corporate-events-on-b3.json";
import coveredCall from "./content/covered-call.json";
import deltaAndGamma from "./content/delta-and-gamma.json";
import exerciseOnB3 from "./content/exercise-on-b3.json";
import expiryAndExerciseRiskOnB3 from "./content/expiry-and-exercise-risk-on-b3.json";
import impliedVolatilityAndIvRank from "./content/implied-volatility-and-iv-rank.json";
import intrinsicAndTimeValue from "./content/intrinsic-and-time-value.json";
import ironCondor from "./content/iron-condor.json";
import longCall from "./content/long-call.json";
import longPut from "./content/long-put.json";
import longStraddle from "./content/long-straddle.json";
import longStrangle from "./content/long-strangle.json";
import moneyness from "./content/moneyness.json";
import portfolioGreeks from "./content/portfolio-greeks.json";
import positionSizingByMaxLoss from "./content/position-sizing-by-max-loss.json";
import putButterfly from "./content/put-butterfly.json";
import readingAFethaSuggestion from "./content/reading-a-fetha-suggestion.json";
import readingAPayoffDiagram from "./content/reading-a-payoff-diagram.json";
import readingTheSeriesCode from "./content/reading-the-series-code.json";
import rollingAPosition from "./content/rolling-a-position.json";
import strikeExpiryPremium from "./content/strike-expiry-premium.json";
import theDecisionJournalAndScoring from "./content/the-decision-journal-and-scoring.json";
import thetaAndTimeDecay from "./content/theta-and-time-decay.json";
import vegaAndIvChanges from "./content/vega-and-iv-changes.json";
import whatIsAnOption from "./content/what-is-an-option.json";

// `catalog.json`'s `lessons` array fixes Jornada order; each entry's file is
// imported explicitly (rather than resolved dynamically by id) so a bundler
// includes every lesson and a missing file is a build error, not a 404.
const LESSON_FILES: readonly unknown[] = [
  whatIsAnOption,
  callsAndPuts,
  strikeExpiryPremium,
  buyingVsWriting,
  exerciseOnB3,
  readingTheSeriesCode,
  moneyness,
  intrinsicAndTimeValue,
  readingAPayoffDiagram,
  impliedVolatilityAndIvRank,
  thetaAndTimeDecay,
  longCall,
  longPut,
  bullCallSpread,
  bullPutSpread,
  bearPutSpread,
  bearCallSpread,
  coveredCall,
  callButterfly,
  putButterfly,
  ironCondor,
  longStraddle,
  longStrangle,
  deltaAndGamma,
  vegaAndIvChanges,
  positionSizingByMaxLoss,
  rollingAPosition,
  corporateEventsOnB3,
  readingAFethaSuggestion,
  portfolioGreeks,
  expiryAndExerciseRiskOnB3,
  backtestHygiene,
  theDecisionJournalAndScoring,
];

export const lessonCatalog: LessonCatalog = lessonCatalogSchema.parse(catalogJson);

export const lessons: readonly Lesson[] = LESSON_FILES.map((file) => lessonSchema.parse(file));

const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

export function getLesson(id: string): Lesson | null {
  return lessonsById.get(id) ?? null;
}

// A lesson placed in the catalog: its own content plus the level and topic
// that `catalog.json`'s `lessons` entry (the only place those live,
// ADR-0081) assigns it.
export type PlacedLesson = Lesson & { level: LevelId; topic: TopicId };

// Jornada order: the catalog's own lesson listing, which is by level then by
// position within it (the content check pins this).
export function jornadaOrder(): readonly PlacedLesson[] {
  return lessonCatalog.lessons
    .map((entry) => {
      const lesson = lessonsById.get(entry.id);
      return lesson ? { ...lesson, level: entry.level, topic: entry.topic } : undefined;
    })
    .filter((placed): placed is PlacedLesson => placed !== undefined);
}
