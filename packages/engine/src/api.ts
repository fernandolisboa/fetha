import type {
  AdjustmentRule,
  Centavos,
  CostModel,
  DecimalString,
  ExitRule,
  ExpirySelection,
  IndicatorSpec,
  Instant,
  Quantity,
  RiskProfile,
  SessionDate,
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

export type EngineError =
  | { code: "invalid_input"; path: string; message: string }
  | { code: "unsupported"; vocabulary: keyof Omit<Capabilities, "engineVersion">; kind: string }
  | { code: "missing_instrument"; ticker: Ticker }
  | { code: "insufficient_data"; needed: DataWindow }
  | {
      code: "no_series_matches";
      underlying: Ticker;
      strikes: StrikeSelection[];
      expiry: ExpirySelection;
    }
  | { code: "unsizeable"; reason: "unbounded_max_loss" | "no_declared_capital" }
  | { code: "checkpoint_mismatch"; expectedDigest: string; receivedDigest: string };

export type NoteCode =
  | "european_pricing"
  | "dividend_yield_defaulted"
  | "candle_form_substituted"
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
  | "no_thesis_claim"
  | "unbounded_max_loss";

export type Note = { code: NoteCode; message: string };

export type MarketViewCollection =
  | "candles"
  | "optionSeries"
  | "optionPrices"
  | "quotes"
  | "macro"
  | "dividendYields"
  | "impliedVolatilityIndex";

export type TruncationReport = {
  collection: MarketViewCollection;
  ticker: Ticker | null;
  dropped: number;
  reason: "after_at" | "unreferenced_instrument";
};

export type PricingModel = "bsm_continuous_yield";

export type Provenance = {
  engineVersion: string;
  pricingModel: PricingModel;
  truncated: TruncationReport[];
};

export type TradingSession = { date: SessionDate; open: Instant; close: Instant };

export type CandleForm = "adjusted" | "nominal";

export type Candle = {
  ticker: Ticker;
  timeframe: Timeframe;
  form: CandleForm;
  session: SessionDate;
  asOf: Instant;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: number;
};

export type OptionRight = "call" | "put";
export type ExerciseStyle = "american" | "european";

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
  volume: number;
};

export type Quote = {
  ticker: Ticker;
  asOf: Instant;
  last: DecimalString | null;
  bid: DecimalString | null;
  ask: DecimalString | null;
};

export type MacroSeriesKind = "cdi" | "selic" | "ipca";

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
  optionSeries: OptionSeries[];
  optionPrices: OptionDayPrice[];
  quotes: Quote[];
  macro: MacroPoint[];
  dividendYields: DividendYieldPoint[];
  impliedVolatilityIndex: ImpliedVolatilityIndexPoint[];
};

export type DataWindow = {
  from: Instant;
  to: Instant;
  instruments: Ticker[];
  timeframes: Timeframe[];
  collections: MarketViewCollection[];
};

export type StrategyVersion = { id: string; definition: StrategyDefinition; structure: Structure };

export type LegRole = "stock" | "call" | "put";
export type Side = "buy" | "sell";

export type Leg = { role: LegRole; side: Side; ticker: Ticker; quantity: Quantity };

export type LegInput = Leg & { price?: DecimalString };

export type OperationLeg = Leg & { entryPrice: DecimalString };

export type OperationStatus = "open" | "adjusted" | "closed" | "expired";

export type Operation = {
  id: string;
  underlying: Ticker;
  legs: OperationLeg[];
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

export type Position = { ticker: Ticker; quantity: Quantity; averageCost: DecimalString };

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
  greeks: Greeks | null;
  timeToExpiryYears: DecimalString | null;
  note?: Note;
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

export type EvaluationOutcome =
  "signal" | "conditions_not_met" | "no_series_match" | "insufficient_data" | "unsizeable";

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

export type FillSource = "next_session_open" | "next_session_average" | "fair_value";

export type SimulatedFill = Fill & { operationId: string; source: FillSource };

export type MissedEntryReason = "no_trades" | "limit_breach" | "no_series_match" | "unsizeable";

export type MissedEntry = {
  ticker: Ticker;
  signalAt: Instant;
  sessionsTried: number;
  reason: MissedEntryReason;
};

export type CloseReason =
  | { kind: "exit_rule"; rule: ExitRule }
  | { kind: "rolled"; toOperationId: string }
  | { kind: "expiry" }
  | { kind: "period_end" };

export type SimulatedOperation = Operation & {
  status: OperationStatus;
  closedAt: SessionDate | null;
  closeReason: CloseReason | null;
  pnl: Centavos;
  maxLoss: Centavos | "unbounded";
};

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
  winRate: DecimalString;
  profitFactor: DecimalString | null;
  exposure: DecimalString;
  fees: Centavos;
  taxes: Centavos;
  slippage: Centavos;
};

export type WalkForwardWindow = { from: SessionDate; to: SessionDate; metrics: BacktestMetrics };

export type MonthlyTax = { month: string; netGain: Centavos; tax: Centavos };

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

export type PositionValuation = {
  position: Position;
  price: DecimalString | null;
  priceSource: PriceSource | null;
  stale: { session: SessionDate } | null;
  value: Centavos | null;
  unrealizedPnl: Centavos | null;
  note?: Note;
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

export type SettlementOutcome = "exercised" | "assigned" | "expired_worthless" | "kept";

export type LegSettlement = {
  leg: OperationLeg;
  outcome: SettlementOutcome;
  intrinsicValue: DecimalString | null;
  proposedFills: Fill[];
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

export type ScoreSubject = DecisionKind | "analysis";

export type DecisionOrigin = { kind: "signal"; strategy: StrategyVersion } | { kind: "manual" };

export type Score = {
  pnl: Centavos | null;
  maxLoss: Centavos | "unbounded";
  normalizedPnl: DecimalString | null;
  thesis: { held: boolean | null; brier: DecimalString | null };
  counterfactualPnl: Centavos | null;
  notes: Note[];
  provenance: Provenance;
};

export type ImpliedVolatilityIndexMethod = "atm_30d_interpolated";

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
  openOperations?: number;
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

export type ProposeSettlementInput = {
  view: MarketView;
  operation: Operation;
  expiry: SessionDate;
};

export type ScoreInput = {
  view: MarketView;
  subject: ScoreSubject;
  decidedAt: Instant;
  horizon: SessionDate;
  confidence: DecimalString;
  claim: ThesisClaim | null;
  operation: Operation;
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
