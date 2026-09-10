import type { EngineErrorCode, NoteCode } from "@fetha/engine";

const en = {
  create: {
    overline: "New backtest",
    title: "Run a backtest",
    universe: "Universe",
    universeHint: "Only instruments already on your watchlist.",
    period: "Period",
    from: "From",
    to: "To",
    capital: "Initial capital",
    limits: "Risk limits",
    limitsEnforce: "Enforce",
    limitsWarn: "Warn only",
    costModel: "Cost model",
    costModelPresets: {
      b3_default: "B3 default (zero stock brokerage)",
      discount_broker: "Discount broker (R$ 4,90 per stock order)",
    },
    submit: "Run backtest",
    error: "Couldn't create the run. Check the fields and try again.",
    invalidCapital: "Enter the initial capital as a valid amount, e.g. 10.000,00.",
    noRiskProfile:
      "Declare a risk profile in Settings before running a backtest, so its limits can be enforced.",
    empty: "Add at least one instrument to your watchlist to run a backtest.",
  },
  report: {
    overline: "Backtest",
    pending: "Not run yet.",
    run: "Run",
    running: "Running…",
    paused: "Paused at session {sessionsDone} of {sessionsTotal}. Continue to keep going.",
    resume: "Continue",
    failed: "The run failed: {error}",
    retry: "Retry",
    metrics: {
      sessions: "Sessions",
      operations: "Operations",
      totalReturn: "Total return",
      cagr: "CAGR",
      maxDrawdown: "Max drawdown",
      sharpe: "Sharpe",
      winRate: "Win rate",
      profitFactor: "Profit factor",
      exposure: "Exposure",
      fees: "Fees",
      taxes: "Taxes",
      slippage: "Slippage",
    },
    equityCurve: "Equity curve",
    drawdown: "Drawdown",
    distribution: "Distribution of returns",
    distributionBasis: "One bar per trading session's own equity return.",
    operationsTable: {
      title: "Operations",
      columns: { underlying: "Instrument", openedAt: "Opened", closedAt: "Closed", pnl: "P&L" },
      empty: "No operations in this period.",
    },
    missedEntries: {
      title: "Missed entries",
      columns: { ticker: "Instrument", signalAt: "Signal", reason: "Reason" },
      empty: "No missed entries.",
    },
    limitBreaches: {
      title: "Limit breaches",
      columns: { session: "Session", ticker: "Instrument", limit: "Limit" },
      empty: "No limit breaches.",
      declaredLimits: "Declared limits",
      modeEnforce: "Enforced",
      modeWarn: "Warn only",
    },
    provenance: {
      title: "Data provenance",
      engineVersion: "Engine version",
      dataVersion: "Data as of",
      dataVersionUnknown: "No dated row loaded",
    },
    notes: "Notes",
  },
  notes: {
    european_pricing: "Priced as a European option; early exercise is not modeled.",
    dividend_yield_defaulted: "Dividend yield not given; assumed zero.",
    no_market_price: "No market price visible for this leg.",
    iv_from_average_price: "Implied volatility computed from the day's average price.",
    iv_not_converged: "The implied-volatility calculation did not converge.",
    below_intrinsic: "Price below intrinsic value.",
    stale_price: "Price carried forward from the series' last trade.",
    no_risk_profile: "No risk profile; limits were not applied.",
    limit_breach_warned: "Limit breach recorded as a warning only.",
    missed_entry: "Entry not filled: no trade in the following session.",
    intraday_option_fill_at_fair_value: "Intraday fill at fair value, not a traded price.",
    short_window_not_annualized: "Window too short to annualize this metric.",
    non_positive_equity: "Equity was non-positive at some point in the run.",
    no_thesis_claim: "No thesis recorded for this decision.",
    no_operation: "No operation was opened.",
    unbounded_max_loss: "Max loss is unbounded.",
    zero_max_loss: "Max loss computed as zero.",
    iv_index_not_bracketed: "No pair of expiries brackets 30 calendar days ahead.",
    risk_free_rate_defaulted: "Risk-free rate not given; assumed zero.",
    negative_cash: "Cash went negative at some point in the run.",
    settlement_pending: "Settlement still pending at period end.",
    settlement_costs_not_modeled: "Settlement costs are not modeled.",
    less_than_one_effective_unit: "Sizing resulted in less than one effective unit.",
    stale_price_across_corporate_action: "Price carried forward across a corporate action.",
    option_strike_unadjusted_across_corporate_action:
      "The option's strike was not adjusted for a corporate action.",
  } satisfies Record<NoteCode, string>,
  engineErrors: {
    invalid_input: "Invalid input.",
    unsupported: "This combination is not supported yet.",
    missing_instrument: "One of the instruments has no data.",
    insufficient_data: "Not enough historical data for this period.",
    no_series_matches: "No option series matches the strategy's strikes.",
    degenerate_strikes: "The resolved strikes were degenerate.",
    unsizeable: "The strategy could not be sized.",
    checkpoint_mismatch: "The engine was updated; the run restarted from the beginning.",
  } satisfies Record<EngineErrorCode, string>,
  // Web-layer error codes runBacktestChunk can also store in the run's
  // `error` column, distinct from the engine's own EngineErrorCode: not a
  // Record<> since the set is open-ended by design (see runErrorMessage).
  webErrors: {
    data_version_changed:
      "The underlying data changed between chunks; the run was stopped rather than mix two datasets.",
    no_market_data: "No market data is available for this period; the run was stopped.",
  },
  networkError: "Network error. Try again.",
};

const ptBR = {
  create: {
    overline: "Nova simulação",
    title: "Rodar um backtest",
    universe: "Universo",
    universeHint: "Só ativos que já estão na sua watchlist.",
    period: "Período",
    from: "De",
    to: "Até",
    capital: "Capital inicial",
    limits: "Limites de risco",
    limitsEnforce: "Aplicar",
    limitsWarn: "Só avisar",
    costModel: "Modelo de custos",
    costModelPresets: {
      b3_default: "Padrão B3 (corretagem de ações zerada)",
      discount_broker: "Corretora desconto (R$ 4,90 por ordem de ação)",
    },
    submit: "Rodar backtest",
    error: "Não foi possível criar a simulação. Confira os campos e tente novamente.",
    invalidCapital: "Informe o capital inicial como um valor válido, por exemplo 10.000,00.",
    noRiskProfile:
      "Declare um perfil de risco em Configurações antes de rodar um backtest, para que os limites possam ser aplicados.",
    empty: "Adicione ao menos um ativo à sua watchlist para rodar um backtest.",
  },
  report: {
    overline: "Backtest",
    pending: "Ainda não foi executado.",
    run: "Executar",
    running: "Executando…",
    paused: "Pausado no pregão {sessionsDone} de {sessionsTotal}. Continue para prosseguir.",
    resume: "Continuar",
    failed: "A simulação falhou: {error}",
    retry: "Tentar novamente",
    metrics: {
      sessions: "Pregões",
      operations: "Operações",
      totalReturn: "Retorno total",
      cagr: "CAGR",
      maxDrawdown: "Drawdown máximo",
      sharpe: "Sharpe",
      winRate: "Taxa de acerto",
      profitFactor: "Fator de lucro",
      exposure: "Exposição",
      fees: "Taxas B3",
      taxes: "Impostos",
      slippage: "Deslizamento",
    },
    equityCurve: "Curva de patrimônio",
    drawdown: "Drawdown",
    distribution: "Distribuição de retornos",
    distributionBasis: "Uma barra por pregão, com o retorno de patrimônio daquele próprio pregão.",
    operationsTable: {
      title: "Operações",
      columns: { underlying: "Ativo", openedAt: "Aberta em", closedAt: "Fechada em", pnl: "P&L" },
      empty: "Nenhuma operação nesse período.",
    },
    missedEntries: {
      title: "Entradas perdidas",
      columns: { ticker: "Ativo", signalAt: "Sinal", reason: "Motivo" },
      empty: "Nenhuma entrada perdida.",
    },
    limitBreaches: {
      title: "Estouros de limite",
      columns: { session: "Pregão", ticker: "Ativo", limit: "Limite" },
      empty: "Nenhum estouro de limite.",
      declaredLimits: "Limites declarados",
      modeEnforce: "Aplicado",
      modeWarn: "Só aviso",
    },
    provenance: {
      title: "Procedência dos dados",
      engineVersion: "Versão do motor",
      dataVersion: "Dados até",
      dataVersionUnknown: "Nenhuma linha datada carregada",
    },
    notes: "Notas",
  },
  // Every engine NoteCode (ADR-0013), translated once here so a report never
  // shows the engine's own English developer-facing message
  // (DESIGN.md "Approximation notes").
  notes: {
    european_pricing: "Precificado como opção europeia; o exercício antecipado não é modelado.",
    dividend_yield_defaulted: "Dividend yield não informado; assumido zero.",
    no_market_price: "Sem preço de mercado visível para esta perna.",
    iv_from_average_price: "Volatilidade implícita calculada a partir do preço médio do dia.",
    iv_not_converged: "O cálculo da volatilidade implícita não convergiu.",
    below_intrinsic: "Preço abaixo do valor intrínseco.",
    stale_price: "Preço carregado do último negócio da série.",
    no_risk_profile: "Sem perfil de risco; os limites não foram aplicados.",
    limit_breach_warned: "Estouro de limite registrado apenas como aviso.",
    missed_entry: "Entrada não executada: sem negócio na sessão seguinte.",
    intraday_option_fill_at_fair_value:
      "Execução intradiária a valor justo, não a preço negociado.",
    short_window_not_annualized: "Janela curta demais para anualizar a métrica.",
    non_positive_equity: "Patrimônio não positivo em algum ponto da simulação.",
    no_thesis_claim: "Sem tese registrada para esta decisão.",
    no_operation: "Nenhuma operação foi aberta.",
    unbounded_max_loss: "Perda máxima não é limitada.",
    zero_max_loss: "Perda máxima calculada como zero.",
    iv_index_not_bracketed: "Nenhum par de vencimentos cobre os 30 dias corridos.",
    risk_free_rate_defaulted: "Taxa livre de risco não informada; assumida como zero.",
    negative_cash: "Caixa ficou negativo em algum ponto da simulação.",
    settlement_pending: "Liquidação ainda pendente no fim do período.",
    settlement_costs_not_modeled: "Custos de liquidação não modelados.",
    less_than_one_effective_unit: "Dimensionamento resultou em menos de uma unidade.",
    stale_price_across_corporate_action: "Preço carregado através de um evento societário.",
    option_strike_unadjusted_across_corporate_action:
      "Strike da opção não foi ajustado por um evento societário.",
  } satisfies Record<NoteCode, string>,
  engineErrors: {
    invalid_input: "Entrada inválida.",
    unsupported: "Essa combinação ainda não é suportada.",
    missing_instrument: "Um dos ativos não tem dados.",
    insufficient_data: "Histórico insuficiente para esse período.",
    no_series_matches: "Nenhuma série de opções corresponde aos strikes da estratégia.",
    degenerate_strikes: "Os strikes resolvidos ficaram degenerados.",
    unsizeable: "Não foi possível dimensionar a estratégia.",
    checkpoint_mismatch: "O motor foi atualizado; a simulação recomeçou do início.",
  } satisfies Record<EngineErrorCode, string>,
  webErrors: {
    data_version_changed:
      "Os dados de mercado mudaram entre os pedaços da simulação; ela foi interrompida em vez de misturar dois conjuntos de dados.",
    no_market_data:
      "Não há dados de mercado disponíveis para esse período; a simulação foi interrompida.",
  },
  networkError: "Erro de rede. Tente novamente.",
} satisfies typeof en;

export const backtestsStrings = { en, ptBR } as const;

export const t = backtestsStrings.ptBR;

export function noteMessage(code: NoteCode): string {
  return t.notes[code];
}

export function engineErrorMessage(code: string): string {
  if (code in t.engineErrors) return t.engineErrors[code as EngineErrorCode];
  if (code in t.webErrors) return t.webErrors[code as keyof typeof t.webErrors];
  return code;
}
