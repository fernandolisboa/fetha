import type {
  AdjustmentRule,
  Centavos,
  Confidence,
  CostModel,
  DecimalString,
  ExitRule,
  ExpirySelection,
  IndicatorSpec,
  Instant,
  LegTemplate,
  Quantity,
  RiskProfile,
  SessionDate,
  SignedQuantity,
  SizingRule,
  StrategyDefinition,
  StrikeSelection,
  Structure,
  ThesisClaim,
  Ticker,
  Timeframe,
} from "@fetha/contracts";

export const ENGINE_VERSION = "0.1.0";

export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };

export type UnsizeableReason = "unbounded_max_loss" | "no_declared_capital" | "zero_units";
export const unsizeableReasons = [
  "unbounded_max_loss",
  "no_declared_capital",
  "zero_units",
] as const satisfies readonly UnsizeableReason[];

export type EngineError =
  | { code: "invalid_input"; path: string; message: string }
  | { code: "unsupported"; vocabulary: CapabilityVocabulary; kind: string }
  | { code: "missing_instrument"; ticker: Ticker }
  | { code: "insufficient_data"; needed: DataWindow }
  | {
      code: "no_series_matches";
      underlying: Ticker;
      strikes: StrikeSelection[];
      expiry: ExpirySelection;
    }
  | {
      code: "degenerate_strikes";
      underlying: Ticker;
      strikes: StrikeSelection[];
      resolved: DecimalString[];
    }
  | { code: "unsizeable"; reason: UnsizeableReason }
  | { code: "checkpoint_mismatch"; expectedDigest: string; receivedDigest: string };

export type EngineErrorCode = EngineError["code"];
export const engineErrorCodes = [
  "invalid_input",
  "unsupported",
  "missing_instrument",
  "insufficient_data",
  "no_series_matches",
  "degenerate_strikes",
  "unsizeable",
  "checkpoint_mismatch",
] as const satisfies readonly EngineErrorCode[];

export type NoteCode =
  | "european_pricing"
  | "dividend_yield_defaulted"
  | "no_market_price"
  | "iv_from_average_price"
  | "iv_not_converged"
  | "below_intrinsic"
  | "stale_price"
  | "no_risk_profile"
  | "limit_breach_warned"
  | "missed_entry"
  | "intraday_option_fill_at_fair_value"
  | "short_window_not_annualized"
  | "non_positive_equity"
  | "no_thesis_claim"
  | "no_operation"
  | "unbounded_max_loss"
  | "zero_max_loss"
  | "iv_index_not_bracketed"
  | "risk_free_rate_defaulted"
  | "negative_cash"
  | "settlement_pending"
  | "settlement_costs_not_modeled"
  | "less_than_one_effective_unit"
  | "stale_price_across_corporate_action";
export const noteCodes = [
  "european_pricing",
  "dividend_yield_defaulted",
  "no_market_price",
  "iv_from_average_price",
  "iv_not_converged",
  "below_intrinsic",
  "stale_price",
  "no_risk_profile",
  "limit_breach_warned",
  "missed_entry",
  "intraday_option_fill_at_fair_value",
  "short_window_not_annualized",
  "non_positive_equity",
  "no_thesis_claim",
  "no_operation",
  "unbounded_max_loss",
  "zero_max_loss",
  "iv_index_not_bracketed",
  "risk_free_rate_defaulted",
  "negative_cash",
  "settlement_pending",
  "settlement_costs_not_modeled",
  "less_than_one_effective_unit",
  "stale_price_across_corporate_action",
] as const satisfies readonly NoteCode[];

export type Note = { code: NoteCode; message: string };

export type MarketViewCollection =
  | "candles"
  | "corporateActions"
  | "optionSeries"
  | "optionPrices"
  | "quotes"
  | "macro"
  | "dividendYields"
  | "impliedVolatilityIndex";
export const marketViewCollections = [
  "candles",
  "corporateActions",
  "optionSeries",
  "optionPrices",
  "quotes",
  "macro",
  "dividendYields",
  "impliedVolatilityIndex",
] as const satisfies readonly MarketViewCollection[];

export type TruncationReason = "after_at" | "unreferenced_instrument";
export const truncationReasons = [
  "after_at",
  "unreferenced_instrument",
] as const satisfies readonly TruncationReason[];

export type TruncationReport = {
  collection: MarketViewCollection;
  ticker: Ticker | null;
  dropped: number;
  reason: TruncationReason;
};

export type PricingModel = "bsm_continuous_yield";
export const pricingModels = ["bsm_continuous_yield"] as const satisfies readonly PricingModel[];

export type Provenance = {
  engineVersion: string;
  pricingModel: PricingModel;
  truncated: TruncationReport[];
  dataVersion: string | null;
  datasetNotes: string[];
};

export type TradingSession = { date: SessionDate; open: Instant; close: Instant };

export type CandleForm = "adjusted" | "nominal";
export const candleForms = ["adjusted", "nominal"] as const satisfies readonly CandleForm[];

export type Candle = {
  ticker: Ticker;
  timeframe: Timeframe;
  session: SessionDate;
  asOf: Instant;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  tradedQuantity: number;
};

export type CorporateActionFactor = {
  ticker: Ticker;
  exDate: SessionDate;
  asOf: Instant;
  factor: DecimalString;
};

export type OptionRight = "call" | "put";
export const optionRights = ["call", "put"] as const satisfies readonly OptionRight[];

export type ExerciseStyle = "american" | "european";
export const exerciseStyles = ["american", "european"] as const satisfies readonly ExerciseStyle[];

export type OptionSeries = {
  ticker: Ticker;
  underlying: Ticker;
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
  style: ExerciseStyle;
  asOf: Instant;
};

export type OptionDayPrice = {
  ticker: Ticker;
  session: SessionDate;
  asOf: Instant;
  average: DecimalString | null;
  close: DecimalString | null;
  trades: number;
  tradedQuantity: number;
};

export type Quote = {
  ticker: Ticker;
  asOf: Instant;
  last: DecimalString | null;
  bid: DecimalString | null;
  ask: DecimalString | null;
};

export type MacroSeriesKind = "cdi" | "selic" | "ipca";
export const macroSeriesKinds = [
  "cdi",
  "selic",
  "ipca",
] as const satisfies readonly MacroSeriesKind[];

export type MacroPoint = {
  series: MacroSeriesKind;
  date: SessionDate;
  asOf: Instant;
  annualRate: DecimalString;
};

export type DividendYieldPoint = { underlying: Ticker; asOf: Instant; annualYield: DecimalString };

export type ImpliedVolatilityIndexPoint = {
  underlying: Ticker;
  session: SessionDate;
  asOf: Instant;
  impliedVolatility: DecimalString;
};

export type MarketView = {
  calendar: TradingSession[];
  candles: Candle[];
  corporateActions: CorporateActionFactor[];
  optionSeries: OptionSeries[];
  optionPrices: OptionDayPrice[];
  quotes: Quote[];
  macro: MacroPoint[];
  dividendYields: DividendYieldPoint[];
  impliedVolatilityIndex: ImpliedVolatilityIndexPoint[];
  dataVersion?: string;
  datasetNotes?: string[];
};

export type DataWindow = {
  from: Instant;
  to: Instant;
  instruments: Ticker[];
  timeframes: Timeframe[];
  collections: MarketViewCollection[];
};

export type StrategyVersion = { id: string; definition: StrategyDefinition; structure: Structure };

export type LegRole = LegTemplate["role"];
export type Side = LegTemplate["side"];

export type Leg = { role: LegRole; side: Side; ticker: Ticker; quantity: Quantity };

export type LegInput = Leg & { price?: DecimalString; volatility?: DecimalString };

export type OperationLeg = Leg & { entryPrice: DecimalString };

export type Operation = {
  id: string;
  underlying: Ticker;
  legs: OperationLeg[];
  expiry: SessionDate | null;
  openedAt: SessionDate;
  strategyVersionId: string | null;
  rolledFrom: string | null;
};

export type Fill = {
  ticker: Ticker;
  side: Side;
  quantity: Quantity;
  price: DecimalString;
  session: SessionDate;
  at: Instant;
  costs: Centavos;
};

export type Position = { ticker: Ticker; quantity: SignedQuantity; averageCost: DecimalString };

export type Greeks = {
  delta: DecimalString;
  gamma: DecimalString;
  theta: DecimalString;
  vega: DecimalString;
  rho: DecimalString;
};

export type RiskLimit = keyof RiskProfile["limits"];

export type LimitBreach = { limit: RiskLimit; value: DecimalString; allowed: DecimalString };

export type PriceSource = "given" | "mid" | "last" | "close" | "average";
export const priceSources = [
  "given",
  "mid",
  "last",
  "close",
  "average",
] as const satisfies readonly PriceSource[];

export type VolatilitySource = "given" | "own_implied" | "last_trade_implied" | "closing_iv_index";
export const volatilitySources = [
  "given",
  "own_implied",
  "last_trade_implied",
  "closing_iv_index",
] as const satisfies readonly VolatilitySource[];

export type LegSelection = {
  structure: Structure;
  underlying: Ticker;
  strikes: StrikeSelection[];
  expiry: ExpirySelection;
  quantity: Quantity | SizingRule;
};

export type LegValuation = {
  leg: Leg;
  price: DecimalString | null;
  priceSource: PriceSource | null;
  stale: { session: SessionDate } | null;
  fairValue: DecimalString | null;
  impliedVolatility: DecimalString | null;
  volatilitySource: VolatilitySource | null;
  greeks: Greeks | null;
  timeToExpiryYears: DecimalString | null;
  notes: Note[];
};

export type PayoffPoint = { underlying: DecimalString; pnl: Centavos };

export type OperationPricing = {
  at: Instant;
  underlying: Ticker;
  spot: DecimalString;
  riskFreeRate: DecimalString;
  dividendYield: DecimalString;
  legs: LegValuation[];
  netPremium: Centavos;
  greeks: Greeks;
  payoff: PayoffPoint[];
  breakEvens: DecimalString[];
  maxLoss: Centavos | "unbounded";
  maxGain: Centavos | "unbounded";
  limitBreaches: LimitBreach[];
  notes: Note[];
  provenance: Provenance;
};

export type IndicatorSeries = {
  ticker: Ticker;
  timeframe: Timeframe;
  form: CandleForm;
  candles: Candle[];
  series: { indicator: IndicatorSpec; values: (DecimalString | null)[] }[];
  notes: Note[];
  provenance: Provenance;
};

export type IndicatorReading = { indicator: IndicatorSpec; value: DecimalString | null };

export type SignalBase = {
  strategyVersionId: string;
  ticker: Ticker;
  timeframe: Timeframe;
  at: Instant;
  session: SessionDate;
  indicators: IndicatorReading[];
};

export type Proposal = { legs: Leg[]; pricing: OperationPricing };

export type Signal = SignalBase &
  (
    | { kind: "entry"; proposal: Proposal }
    | { kind: "exit"; operationId: string; rule: ExitRule }
    | { kind: "adjust"; operationId: string; rule: AdjustmentRule; proposal: Proposal }
  );

export type SignalKind = Signal["kind"];
export const signalKinds = ["entry", "exit", "adjust"] as const satisfies readonly SignalKind[];

export type EvaluationOutcome =
  | "signal"
  | "conditions_not_met"
  | "no_series_match"
  | "degenerate_strikes"
  | "insufficient_data"
  | "unsizeable";
export const evaluationOutcomes = [
  "signal",
  "conditions_not_met",
  "no_series_match",
  "degenerate_strikes",
  "insufficient_data",
  "unsizeable",
] as const satisfies readonly EvaluationOutcome[];

export type EvaluationRecord = {
  ticker: Ticker;
  at: Instant;
  session: SessionDate;
  outcome: EvaluationOutcome;
  detail: string | null;
};

export type Evaluation = {
  signals: Signal[];
  evaluations: EvaluationRecord[];
  notes: Note[];
  provenance: Provenance;
};

export type LimitMode = "enforce" | "warn";
export const limitModes = ["enforce", "warn"] as const satisfies readonly LimitMode[];

export type BacktestConfig = {
  strategy: StrategyVersion;
  universe: Ticker[];
  period: { from: SessionDate; to: SessionDate };
  initialCapital: Centavos;
  costModel: CostModel;
  riskProfile: RiskProfile;
  limits: LimitMode;
  sizing: SizingRule | null;
  walkForward: { windowSessions: number } | null;
  seed: number;
};

export type BacktestCheckpoint = {
  schema: 1;
  engineVersion: string;
  configDigest: string;
  cursor: SessionDate;
  state: unknown;
};

export type FillSource =
  "next_session_open" | "next_session_average" | "next_candle_open" | "fair_value" | "settlement";
export const fillSources = [
  "next_session_open",
  "next_session_average",
  "next_candle_open",
  "fair_value",
  "settlement",
] as const satisfies readonly FillSource[];

export type SimulatedFill = Fill & { operationId: string; source: FillSource };

export type MissedEntryReason =
  "no_trades" | "limit_breach" | "no_series_match" | "degenerate_strikes" | "unsizeable";
export const missedEntryReasons = [
  "no_trades",
  "limit_breach",
  "no_series_match",
  "degenerate_strikes",
  "unsizeable",
] as const satisfies readonly MissedEntryReason[];

export type MissedEntry = {
  ticker: Ticker;
  signalAt: Instant;
  sessionsTried: number;
  reason: MissedEntryReason;
};

export type CloseReason =
  | { kind: "exit_rule"; rule: ExitRule }
  | { kind: "rolled"; toOperationId: string }
  | { kind: "period_end" };

export type CloseReasonKind = CloseReason["kind"];
export const closeReasonKinds = [
  "exit_rule",
  "rolled",
  "period_end",
] as const satisfies readonly CloseReasonKind[];

export type SettlementOutcome = "kept" | "exercised" | "assigned" | "expired_worthless";
export const settlementOutcomes = [
  "kept",
  "exercised",
  "assigned",
  "expired_worthless",
] as const satisfies readonly SettlementOutcome[];

export type LegSettlement =
  | { leg: OperationLeg & { role: "stock" }; outcome: "kept"; intrinsicValue: null; fills: Fill[] }
  | {
      leg: OperationLeg & { role: Exclude<LegRole, "stock">; side: "buy" };
      outcome: "exercised" | "expired_worthless";
      intrinsicValue: DecimalString;
      fills: Fill[];
    }
  | {
      leg: OperationLeg & { role: Exclude<LegRole, "stock">; side: "sell" };
      outcome: "assigned" | "expired_worthless";
      intrinsicValue: DecimalString;
      fills: Fill[];
    };

export type SimulatedOperation = Operation & {
  pnl: Centavos;
  maxLoss: Centavos | "unbounded";
} & (
    | { status: "closed"; closedAt: SessionDate; closeReason: CloseReason }
    | { status: "expired"; closedAt: SessionDate; settlement: LegSettlement[] }
  );

export type SimulatedOperationStatus = SimulatedOperation["status"];
export const simulatedOperationStatuses = [
  "closed",
  "expired",
] as const satisfies readonly SimulatedOperationStatus[];

export type EquityPoint = {
  session: SessionDate;
  equity: Centavos;
  cash: Centavos;
  drawdown: DecimalString;
};

export type BacktestMetrics = {
  sessions: number;
  operations: number;
  totalReturn: DecimalString;
  cagr: DecimalString | null;
  maxDrawdown: DecimalString;
  sharpe: DecimalString | null;
  winRate: DecimalString | null;
  profitFactor: DecimalString | null;
  exposure: DecimalString;
  fees: Centavos;
  taxes: Centavos;
  slippage: Centavos;
};

export type WalkForwardWindow = { from: SessionDate; to: SessionDate; metrics: BacktestMetrics };

export type MonthlyTax = {
  month: string;
  stockSales: Centavos;
  stockGain: Centavos;
  optionGain: Centavos;
  exemptGain: Centavos;
  netGain: Centavos;
  tax: Centavos;
};

export type SessionLimitBreach = LimitBreach & { session: SessionDate; ticker: Ticker };

export type BacktestRun = {
  config: BacktestConfig;
  configDigest: string;
  operations: SimulatedOperation[];
  fills: SimulatedFill[];
  missedEntries: MissedEntry[];
  limitBreaches: SessionLimitBreach[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  walkForward: WalkForwardWindow[] | null;
  taxes: MonthlyTax[];
  notes: Note[];
  provenance: Provenance;
};

export type BacktestProgress =
  | {
      status: "paused";
      checkpoint: BacktestCheckpoint;
      sessionsDone: number;
      sessionsTotal: number;
      next: DataWindow;
    }
  | { status: "complete"; run: BacktestRun };

export type BacktestProgressStatus = BacktestProgress["status"];
export const backtestProgressStatuses = [
  "paused",
  "complete",
] as const satisfies readonly BacktestProgressStatus[];

export type PositionValuation = {
  position: Position;
  price: DecimalString | null;
  priceSource: PriceSource | null;
  stale: { session: SessionDate } | null;
  value: Centavos | null;
  unrealizedPnl: Centavos | null;
  notes: Note[];
};

export type OperationValuation = {
  operation: Operation;
  pricing: OperationPricing;
  unrealizedPnl: Centavos;
};

export type PortfolioValuation = {
  at: Instant;
  positions: PositionValuation[];
  operations: OperationValuation[];
  totals: { equity: Centavos; cash: Centavos; unrealizedPnl: Centavos; greeks: Greeks };
  limitBreaches: LimitBreach[];
  notes: Note[];
  provenance: Provenance;
};

export type SettlementProposal = {
  operationId: string;
  expiry: SessionDate;
  underlyingClose: DecimalString;
  legs: LegSettlement[];
  notes: Note[];
  provenance: Provenance;
};

export type DecisionKind = "enter" | "do_not_enter" | "hold" | "adjust" | "exit";
export const decisionKinds = [
  "enter",
  "do_not_enter",
  "hold",
  "adjust",
  "exit",
] as const satisfies readonly DecisionKind[];

export type ScoreSubject = DecisionKind | "analysis";
export const scoreSubjects = [
  ...decisionKinds,
  "analysis",
] as const satisfies readonly ScoreSubject[];

export type DecisionOrigin = { kind: "signal"; strategy: StrategyVersion } | { kind: "manual" };

export type DecisionOriginKind = DecisionOrigin["kind"];
export const decisionOriginKinds = [
  "signal",
  "manual",
] as const satisfies readonly DecisionOriginKind[];

export type PnlScore =
  | { pnl: null; maxLoss: null; normalizedPnl: null }
  | { pnl: Centavos; maxLoss: "unbounded"; normalizedPnl: null }
  | { pnl: Centavos; maxLoss: Centavos; normalizedPnl: DecimalString | null };

export type ThesisScore =
  { claim: null } | { claim: ThesisClaim; held: boolean; brier: DecimalString };

export type Score = PnlScore & {
  thesis: ThesisScore;
  counterfactualPnl: Centavos | null;
  notes: Note[];
  provenance: Provenance;
};

export type ImpliedVolatilityIndexMethod = "atm_30d_variance_interpolated";
export const impliedVolatilityIndexMethods = [
  "atm_30d_variance_interpolated",
] as const satisfies readonly ImpliedVolatilityIndexMethod[];

export type ImpliedVolatilityIndex = {
  underlying: Ticker;
  session: SessionDate;
  impliedVolatility: DecimalString | null;
  method: ImpliedVolatilityIndexMethod;
  seriesUsed: Ticker[];
  notes: Note[];
  provenance: Provenance;
};

export type Capabilities = {
  engineVersion: string;
  timeframes: Timeframe[];
  indicators: IndicatorSpec["kind"][];
  strikeSelections: StrikeSelection["kind"][];
  expirySelections: ExpirySelection["kind"][];
  sizingRules: SizingRule["kind"][];
  exitRules: ExitRule["kind"][];
  adjustmentRules: AdjustmentRule["kind"][];
  thesisClaims: ThesisClaim["kind"][];
  pricingModels: PricingModel[];
};

export type CapabilityVocabulary = keyof Omit<Capabilities, "engineVersion">;
export const capabilityVocabularies = [
  "timeframes",
  "indicators",
  "strikeSelections",
  "expirySelections",
  "sizingRules",
  "exitRules",
  "adjustmentRules",
  "thesisClaims",
  "pricingModels",
] as const satisfies readonly CapabilityVocabulary[];

export type DataWindowInput = {
  strategy: StrategyVersion;
  instruments: Ticker[];
  calendar: TradingSession[];
  at: Instant;
  since?: Instant;
};

export type IndicatorsInput = {
  view: MarketView;
  ticker: Ticker;
  timeframe: Timeframe;
  indicators: IndicatorSpec[];
  at: Instant;
  form?: CandleForm;
};

export type PriceOperationInput = {
  view: MarketView;
  at: Instant;
  legs: LegInput[] | LegSelection;
  riskProfile?: RiskProfile;
  openOperationCount?: number;
};

export type EvaluateStrategyInput = {
  view: MarketView;
  strategy: StrategyVersion;
  instruments: Ticker[];
  at: Instant;
  since?: Instant;
  openOperations?: Operation[];
  riskProfile?: RiskProfile;
};

export type RunBacktestInput = {
  view: MarketView;
  config: BacktestConfig;
  resume?: BacktestCheckpoint;
  maxSessions?: number;
};

export type MarkToMarketInput = {
  view: MarketView;
  at: Instant;
  positions: Position[];
  operations: Operation[];
  cash: Centavos;
  riskProfile?: RiskProfile;
};

export type ProposeSettlementInput = { view: MarketView; operation: Operation };

export type ScoreInput = {
  view: MarketView;
  subject: ScoreSubject;
  decidedAt: Instant;
  horizon: SessionDate;
  confidence: Confidence;
  claim: ThesisClaim | null;
  operation?: Operation;
  realizedFills: Fill[];
  origin: DecisionOrigin;
  costModel: CostModel;
};

export type ImpliedVolatilityIndexInput = { view: MarketView; underlying: Ticker; at: Instant };

export interface Engine {
  capabilities(): Capabilities;
  dataWindow(input: DataWindowInput): DataWindow;
  indicators(input: IndicatorsInput): Promise<Result<IndicatorSeries>>;
  priceOperation(input: PriceOperationInput): Promise<Result<OperationPricing>>;
  evaluateStrategy(input: EvaluateStrategyInput): Promise<Result<Evaluation>>;
  runBacktest(input: RunBacktestInput): Promise<Result<BacktestProgress>>;
  markToMarket(input: MarkToMarketInput): Promise<Result<PortfolioValuation>>;
  proposeSettlement(input: ProposeSettlementInput): Promise<Result<SettlementProposal>>;
  score(input: ScoreInput): Promise<Result<Score>>;
  impliedVolatilityIndex(
    input: ImpliedVolatilityIndexInput,
  ): Promise<Result<ImpliedVolatilityIndex>>;
}
