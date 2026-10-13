import { z } from "zod";

import {
  confidenceSchema,
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type Confidence,
  type SessionDate,
} from "./scalars";
import type { AnalysisOutlookClaim } from "./thesis-claim";

export const analysisSubjectKinds = [
  "signal",
  "contemplated_operation",
  "held_operation",
  "backtest_run",
] as const;
export const analysisSubjectKindSchema = z.enum(analysisSubjectKinds);
export type AnalysisSubjectKind = z.infer<typeof analysisSubjectKindSchema>;

// A fact is what the screen shows (docs/adr/0057): every leaf is already a
// pt-BR display string ("R$ 1.234,56", "2,08%", "17/10/2026") or null, so the
// model cites a figure by copying it, never by converting a raw value.
export type AnalysisFact =
  string | null | readonly AnalysisFact[] | { readonly [key: string]: AnalysisFact };

const FACT_KEY = /^[a-z][a-zA-Z0-9]*$/;
// Deep enough for the deepest tree assembly can produce for a legal
// strategy: a condition at `MAX_CONDITION_DEPTH` (6), inside an exit rule,
// inside a `roll` adjustment's `when`, inside the strategy, inside a
// backtest run's facts, measures 18 by this module's own `factDepth`; kept
// with margin above that so a slightly different assembly shape never
// trips the cap by accident.
const MAX_FACT_DEPTH = 20;

export const analysisFactSchema: z.ZodType<AnalysisFact> = z.lazy(() =>
  z.union([
    z.string().max(200),
    z.null(),
    z.array(analysisFactSchema).max(60),
    z.record(z.string().regex(FACT_KEY), analysisFactSchema),
  ]),
);

export const analysisFactsSchema = z
  .record(z.string().regex(FACT_KEY), analysisFactSchema)
  .refine((facts) => factDepth(facts) <= MAX_FACT_DEPTH, {
    message: `facts nest at most ${String(MAX_FACT_DEPTH)} levels`,
  });
export type AnalysisFacts = z.infer<typeof analysisFactsSchema>;

export const analysisInputsSchema = z.strictObject({
  subject: analysisSubjectKindSchema,
  facts: analysisFactsSchema,
});
export type AnalysisInputs = z.infer<typeof analysisInputsSchema>;

export const analysisConfidenceLevels = ["low", "medium", "high"] as const;
export type AnalysisConfidenceLevel = (typeof analysisConfidenceLevels)[number];

const prose = (max: number) => z.string().trim().min(1).max(max);

// ADR-0009's contract. Confidence is a closed level, not a number: a number
// the model makes up is exactly what the citation check forbids.
export const analysisOutputSchema = z.strictObject({
  thesis: prose(1500),
  counterThesis: prose(1500),
  keyRisks: z.array(prose(600)).min(1).max(6),
  maxLoss: prose(600),
  breakEvens: prose(600),
  invalidation: z.array(prose(600)).min(1).max(5),
  confidence: z.strictObject({
    level: z.enum(analysisConfidenceLevels),
    justification: prose(800),
  }),
  inputsCited: z.array(z.string().min(1).max(120)).min(1).max(40),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export const analysisHorizons = ["one_week", "one_month", "three_months", "expiry"] as const;
export type AnalysisHorizon = (typeof analysisHorizons)[number];

// Sessions after the request's anchor session (docs/adr/0058): a trading
// week, month and quarter of B3 sessions.
export const analysisHorizonSessions: Record<Exclude<AnalysisHorizon, "expiry">, number> = {
  one_week: 5,
  one_month: 21,
  three_months: 63,
};

export const analysisLikelihoods = ["somewhat_likely", "likely", "very_likely"] as const;
export type AnalysisLikelihood = (typeof analysisLikelihoods)[number];

// docs/adr/0058: the model picks a word, never a number; this table is the
// claim's confidence for the Brier term. It starts above even odds because
// the model always states the outcome it finds more likely.
export const analysisLikelihoodConfidence: Record<AnalysisLikelihood, Confidence> = {
  somewhat_likely: confidenceSchema.parse("0.6"),
  likely: confidenceSchema.parse("0.75"),
  very_likely: confidenceSchema.parse("0.9"),
};

const factPath = z.string().min(1).max(120);

export const analysisOutlookSchema = z.strictObject({
  instrumentFact: factPath,
  direction: z.enum(["above", "below"]),
  levelFact: factPath,
  horizon: z.enum(analysisHorizons),
  likelihood: z.enum(analysisLikelihoods),
});
export type AnalysisOutlook = z.infer<typeof analysisOutlookSchema>;

// The `analysis@2` contract (docs/adr/0058): `analysis@1`'s fields plus the
// outlook that makes an analysis scorable, null when the facts support no
// verifiable claim.
export const analysisOutputV2Schema = analysisOutputSchema.extend({
  outlook: analysisOutlookSchema.nullable(),
});
export type AnalysisOutputV2 = z.infer<typeof analysisOutputV2Schema>;

// What an accepted row may hold: a reply to either released version.
export const storedAnalysisOutputSchema = z.union([analysisOutputV2Schema, analysisOutputSchema]);
export type StoredAnalysisOutput = AnalysisOutput | AnalysisOutputV2;

export function outlookOf(output: StoredAnalysisOutput): AnalysisOutlook | null {
  return "outlook" in output ? output.outlook : null;
}

export type AnalysisOutlookHorizon =
  { kind: "sessions"; count: number } | { kind: "expiry"; expiry: SessionDate };

export type AnalysisOutlookProblem = "instrument_fact" | "level_fact" | "expiry_fact";

export type ResolvedAnalysisOutlook =
  | {
      ok: true;
      claim: AnalysisOutlookClaim;
      confidence: Confidence;
      horizon: AnalysisOutlookHorizon;
    }
  | { ok: false; problem: AnalysisOutlookProblem };

const PRICE_FACT = /^R\$ (\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/;

// The subject's own ticker, and only a per-share price of it: a money amount
// (max gain, net premium) or an option premium is also written in reais but
// is no level for the underlying, and would make a claim hold trivially
// (docs/adr/0058).
const INSTRUMENT_FACT_PATHS = new Set(["underlying", "ticker"]);
const LEVEL_FACT_PATH =
  /^(?:proposal\.)?pricing\.(?:spot|breakEvens\.\d+|payoff\.\d+\.underlying)$/;

// A positive price in reais exactly as `formatPriceBRL` writes it
// ("R$ 1.234,56"); anything else (a percentage, a negative amount, a count)
// is not a level.
function priceFromFact(fact: string): string | null {
  const match = PRICE_FACT.exec(fact);
  if (!match) return null;
  const decimal = `${(match[1] ?? "").replaceAll(".", "")}.${match[2] ?? ""}`;
  const parsed = decimalStringSchema.safeParse(canonical(decimal));
  if (!parsed.success || /^0(\.0+)?$/.test(parsed.data)) return null;
  return parsed.data;
}

function sessionFromFact(fact: AnalysisFact | undefined): SessionDate | null {
  if (typeof fact !== "string" || !DATE.test(fact)) return null;
  const [day, month, year] = fact.split("/");
  const parsed = sessionDateSchema.safeParse(`${year ?? ""}-${month ?? ""}-${day ?? ""}`);
  return parsed.success ? parsed.data : null;
}

// docs/adr/0058: turns the model's outlook into the engine's claim. The
// instrument and the level are read from the facts the paths name, never
// from anything the model wrote, so the claim holds no figure the facts do
// not.
export function resolveAnalysisOutlook(
  inputs: AnalysisInputs,
  outlook: AnalysisOutlook,
): ResolvedAnalysisOutlook {
  const instrument = INSTRUMENT_FACT_PATHS.has(outlook.instrumentFact)
    ? tickerSchema.safeParse(factAt(inputs.facts, outlook.instrumentFact))
    : null;
  if (!instrument?.success) {
    return { ok: false, problem: "instrument_fact" };
  }
  const levelFact = LEVEL_FACT_PATH.test(outlook.levelFact)
    ? factAt(inputs.facts, outlook.levelFact)
    : undefined;
  const level = typeof levelFact === "string" ? priceFromFact(levelFact) : null;
  if (level === null) {
    return { ok: false, problem: "level_fact" };
  }

  let horizon: AnalysisOutlookHorizon;
  if (outlook.horizon === "expiry") {
    const expiry = sessionFromFact(factAt(inputs.facts, "expiry"));
    const session = sessionFromFact(factAt(inputs.facts, "session"));
    if (expiry === null || session === null || expiry <= session) {
      return { ok: false, problem: "expiry_fact" };
    }
    horizon = { kind: "expiry", expiry };
  } else {
    horizon = { kind: "sessions", count: analysisHorizonSessions[outlook.horizon] };
  }

  return {
    ok: true,
    claim: {
      kind: outlook.direction === "above" ? "close_above" : "close_below",
      instrument: instrument.data,
      level: decimalStringSchema.parse(level),
    },
    confidence: analysisLikelihoodConfidence[outlook.likelihood],
    horizon,
  };
}

export type AnalysisCitationCheck =
  { ok: true } | { ok: false; uncitedFigures: string[]; unknownPaths: string[] };

// docs/adr/0057: every figure the reply writes must be one the facts hold
// (by absolute value: "perda de R$ 500,00" cites a max loss of
// "−R$ 500,00"), and every cited path must name a fact.
export function checkAnalysisCitations(
  inputs: AnalysisInputs,
  output: AnalysisOutput,
): AnalysisCitationCheck {
  const known = new Set(collectFactStrings(inputs.facts).flatMap(figureKeys));
  const uncitedFigures = unique(
    outputProse(output)
      .flatMap(figuresIn)
      .filter((figure) => !figure.keys.some((key) => known.has(key)))
      .map((figure) => figure.text),
  );
  const unknownPaths = unique(
    output.inputsCited.filter((path) => factAt(inputs.facts, path) === undefined),
  );
  return uncitedFigures.length === 0 && unknownPaths.length === 0
    ? { ok: true }
    : { ok: false, uncitedFigures, unknownPaths };
}

interface Figure {
  text: string;
  keys: string[];
}

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const PT_BR_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}_]/u;

// A figure is a maximal run of digits and inner separators that no letter
// touches: "PETR4", "B3" and "BOVA11" are names, "R$ 1.234,56" holds the
// figure "1.234,56". A dd/mm/yyyy date is one figure, compared as a date.
export function figuresIn(text: string): Figure[] {
  const figures: Figure[] = [];
  for (const match of text.matchAll(/\d(?:[\d.,/]*\d)?/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(0, start).at(-1) ?? "";
    const after = text.at(end) ?? "";
    if (LETTER_OR_DIGIT.test(before) || LETTER_OR_DIGIT.test(after)) {
      continue;
    }
    figures.push(...splitRun(match[0]));
  }
  return figures;
}

function splitRun(run: string): Figure[] {
  if (DATE.test(run)) {
    return [{ text: run, keys: [`date:${run}`] }];
  }
  if (run.includes("/")) {
    return run.split("/").flatMap((part) => (part === "" ? [] : splitRun(part)));
  }
  return [{ text: run, keys: numberKeys(run) }];
}

// Every reading a pt-BR run can have: "1.234" is a thousand two hundred
// thirty-four in pt-BR but one and a bit in en, and either is accepted when
// the facts hold it. A run with no valid reading has no key and never
// matches, so a malformed figure is rejected, not ignored.
function numberKeys(run: string): string[] {
  const readings: string[] = [];
  const commas = run.split(",").length - 1;
  if (commas === 1) {
    const [integer = "", fraction = ""] = run.split(",");
    if (integer === "" || PT_BR_THOUSANDS.test(integer) || /^\d+$/.test(integer)) {
      readings.push(`${integer.replaceAll(".", "")}.${fraction}`);
    }
  } else if (commas === 0) {
    if (/^\d+$/.test(run) || PT_BR_THOUSANDS.test(run)) {
      readings.push(run.replaceAll(".", ""));
    }
    if (/^\d+\.\d+$/.test(run)) {
      readings.push(run);
    }
  }
  return unique(readings.filter((reading) => /^\d+(\.\d+)?$/.test(reading))).map(
    (reading) => `number:${canonical(reading)}`,
  );
}

function canonical(decimal: string): string {
  const [integer = "0", fraction = ""] = decimal.split(".");
  const trimmedInteger = integer.replace(/^0+(?=\d)/, "");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction === "" ? trimmedInteger : `${trimmedInteger}.${trimmedFraction}`;
}

function figureKeys(text: string): string[] {
  return figuresIn(text).flatMap((figure) => figure.keys);
}

function outputProse(output: AnalysisOutput): string[] {
  return [
    output.thesis,
    output.counterThesis,
    ...output.keyRisks,
    output.maxLoss,
    output.breakEvens,
    ...output.invalidation,
    output.confidence.justification,
  ];
}

function collectFactStrings(fact: AnalysisFact): string[] {
  if (fact === null) return [];
  if (typeof fact === "string") return [fact];
  if (isFactList(fact)) return fact.flatMap(collectFactStrings);
  return Object.values(fact).flatMap(collectFactStrings);
}

// A path is dot-separated keys and list indices: "pricing.legs.0.strike".
export function factAt(facts: AnalysisFacts, path: string): AnalysisFact | undefined {
  let node: AnalysisFact | undefined = facts;
  for (const segment of path.split(".")) {
    if (node === null || node === undefined || typeof node === "string") {
      return undefined;
    }
    if (isFactList(node)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      node = node[Number(segment)];
    } else {
      node = Object.hasOwn(node, segment) ? node[segment] : undefined;
    }
  }
  return node;
}

function isFactList(fact: AnalysisFact): fact is readonly AnalysisFact[] {
  return Array.isArray(fact);
}

function factDepth(fact: AnalysisFact): number {
  if (fact === null || typeof fact === "string") return 0;
  const children = isFactList(fact) ? fact : Object.values(fact);
  return 1 + Math.max(0, ...children.map(factDepth));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
