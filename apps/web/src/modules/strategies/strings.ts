import type { EvaluationOutcome, EvaluationReason } from "@fetha/engine";

import { isWebEvaluationReason, type WebEvaluationReason } from "./evaluation-vocabulary";

// One rendering function per web-authored reason (#133, follow-up from
// #80): `unknown_structure`, `unsatisfiable_collection`, `market_view_too_large`
// and `no_market_data` carry no user-facing parameter (the collection name
// is an internal identifier, never surfaced — round 7 item 4's
// collection-neutral copy carries forward unchanged), `engine_error` and
// `catchup_clamped` render the `detail` column's own parameter (the engine
// error code, the dropped session count). `market_view_too_large` and
// `no_market_data` mirror the wording `backtests/strings.ts`'s `webErrors`
// already uses for the same two `loadMarketView` failures in a backtest
// run.
type WebReasonFormatter = (detail: string | null) => string;

const webReasonTextEn: Record<WebEvaluationReason, WebReasonFormatter> = {
  unknown_structure: () => "The strategy's structure no longer exists in the catalog",
  engine_error: (detail) => `Engine error (${detail ?? ""})`,
  catchup_clamped: (detail) => `Catch-up capped: ${detail ?? "0"} older session(s) skipped`,
  unsatisfiable_collection: () =>
    "Requires market data with no source yet for one of this strategy's indicators",
  market_view_too_large: () =>
    "This watchlist lists more option series than a single evaluation can load. Narrow the watchlist and try again.",
  no_market_data: () => "No market data is available for this period; the evaluation was skipped.",
};

const webReasonTextPtBR: Record<WebEvaluationReason, WebReasonFormatter> = {
  unknown_structure: () => "A estrutura da estratégia não existe mais no catálogo",
  engine_error: (detail) => `Erro do motor (${detail ?? ""})`,
  catchup_clamped: (detail) =>
    `Atualização limitada: ${detail ?? "0"} sessão(ões) mais antiga(s) ignorada(s)`,
  unsatisfiable_collection: () =>
    "Requer dados de mercado ainda sem fonte para um dos indicadores dessa estratégia",
  market_view_too_large: () =>
    "Essa watchlist lista mais séries de opções do que uma avaliação consegue carregar de uma vez. Reduza a watchlist e tente de novo.",
  no_market_data: () =>
    "Não há dados de mercado disponíveis para esse período; a avaliação foi ignorada.",
};

// The engine's stable `EvaluationReason` code (#80), translated exhaustively:
// a code the engine adds without a matching entry here fails to typecheck,
// unlike the pre-#80 exact-sentence string match this replaced. `signal`
// and `conditions_not_met` map to `null`: both reasons add nothing beyond
// their own outcome label (`t.inbox.outcomes.signal` /
// `t.inbox.outcomes.conditions_not_met` already say the same thing), so a
// non-null entry here would render as a "Signal · Signal"-shaped repeat.
const reasonTextEn: Record<EvaluationReason, string | null> = {
  signal: null,
  conditions_not_met: null,
  no_candles: "No candles for this instrument and timeframe",
  no_candles_in_catch_up_window:
    "No candles in the evaluated window for this instrument and timeframe",
  entry_condition_warmup: "Entry condition needs more warm-up data",
  no_series_match: "No listed option series satisfies the strike and expiry selection",
  degenerate_strikes: "Two distinct strike ranks resolved to the same listed strike",
  no_declared_capital: "No declared capital to size against",
  unbounded_max_loss: "Cannot size: the max loss is unbounded",
  zero_units: "A unit carries no cost or risk to size against",
  unaffordable_budget: "The declared capital and fraction cannot afford one unit",
  insufficient_market_data_for_proposal:
    "Not enough market data to select strikes or price the proposal",
  exit_rule_unknown: "Cannot evaluate this operation's exit rules right now",
  profit_target_zero_base: "Profit target cannot fire: the operation's premium base is zero",
  stop_loss_zero_base: "Stop loss cannot fire: the operation's max-loss base is zero",
};

const reasonTextPtBR: Record<EvaluationReason, string | null> = {
  signal: null,
  conditions_not_met: null,
  no_candles: "Sem candles para este ativo nessa escala de tempo",
  no_candles_in_catch_up_window:
    "Sem candles no intervalo avaliado para este ativo nessa escala de tempo",
  entry_condition_warmup: "A condição de entrada precisa de mais histórico de aquecimento",
  no_series_match: "Nenhuma série de opção listada atende à seleção de strike e vencimento",
  degenerate_strikes: "Dois ranks de strike distintos resolveram para o mesmo strike listado",
  no_declared_capital: "Sem capital declarado para dimensionar",
  unbounded_max_loss: "Não dá para dimensionar: a perda máxima é ilimitada",
  zero_units: "Não há custo nem risco por unidade para dimensionar",
  unaffordable_budget: "O capital declarado, com essa fração, não cobre nem uma unidade",
  insufficient_market_data_for_proposal:
    "Dados de mercado insuficientes para selecionar strikes ou precificar a proposta",
  exit_rule_unknown: "Não é possível avaliar as regras de saída desta operação agora",
  profit_target_zero_base: "O alvo de lucro não pode disparar: a base de prêmio da operação é zero",
  stop_loss_zero_base: "O stop não pode disparar: a base de perda máxima da operação é zero",
};

const en = {
  list: {
    overline: "Strategies",
    title: "Strategies",
    newStrategy: "New strategy",
    mine: {
      title: "My strategies",
      empty: "No strategy in your catalog yet. Create one from a structure.",
      columns: { name: "Name", visibility: "Visibility", version: "Version", updatedAt: "Updated" },
      edit: "Edit",
      share: "Share",
      unshare: "Stop sharing",
      shareError: "Couldn't update sharing. Try again.",
      active: "Active",
    },
    shared: {
      title: "Shared by other users",
      empty: "No strategy shared yet.",
      copy: "Copy",
      copyError: "Couldn't copy the strategy. Try again.",
    },
    visibility: { private: "Private", shared: "Shared" },
    emptyCatalog:
      "The structure catalog is not seeded yet, so there is nothing to build a strategy from.",
  },
  editor: {
    createOverline: "New strategy",
    editOverline: "Edit strategy",
    name: { label: "Name" },
    timeframe: { label: "Timeframe" },
    structure: { label: "Structure" },
    entry: {
      title: "Entry conditions",
      subtitle: "All conditions must hold (AND).",
      addCondition: "Add condition",
      removeCondition: "Remove condition",
      comparator: "Comparator",
      leftOperand: "First value",
      rightOperand: "Second value",
      readOnlyNotice:
        "This condition combines and/or/not in a way the editor cannot show as rows yet. It is kept unchanged.",
    },
    operand: {
      kind: "Type",
      indicatorKind: "Indicator",
      indicatorLength: "Length",
      indicatorLookback: "Lookback sessions",
      priceField: "Field",
      constantValue: "Value",
    },
    strikes: {
      title: "Strike selection",
      subtitle: "One row per strike, ranked in order.",
      addStrike: "Add strike",
      removeStrike: "Remove strike",
      kind: "Method",
      kinds: { delta: "Delta", moneyness: "Moneyness", nearest: "Nearest" },
      delta: { target: "Target delta" },
      moneyness: { percent: "Moneyness (%)" },
      nearest: { price: "Reference price" },
    },
    expiry: {
      title: "Expiry window",
      min: "Minimum business days",
      max: "Maximum business days",
    },
    sizing: {
      title: "Sizing",
      kind: "Method",
      fraction: "Fraction",
      fixed_fractional: "Fixed fractional",
      fixed_risk: "Fixed risk",
    },
    exit: {
      title: "Exit rules",
      addRule: "Add rule",
      removeRule: "Remove rule",
      kind: "Type",
      profit_target: "Profit target",
      stop_loss: "Stop loss",
      days_before_expiry: "Days before expiry",
      condition: "Condition",
      fractionOfPremium: "Fraction of the premium",
      multipleOfMaxLoss: "Multiple of the max loss",
      businessDays: "Business days",
      readOnlyNotice:
        "This exit condition combines and/or/not in a way the editor cannot show as rows yet. It is kept unchanged.",
    },
    adjustments: {
      title: "Adjustments",
      subtitle: "Optional rolls to a new expiry and strikes.",
      addAdjustment: "Add adjustment",
      removeAdjustment: "Remove adjustment",
      when: "Roll when",
    },
    submit: { create: "Create strategy", save: "Save new version" },
    cancel: "Cancel",
    invalid: "Some fields are invalid. Review the values before saving.",
    fieldInvalid: "Invalid value",
    errors: {
      invalid: "Some fields are invalid. Review the values before saving.",
      not_found: "This strategy no longer exists.",
      not_shared: "This strategy is not shared.",
      conflict: "Someone else just changed this strategy. Reload and try again.",
      unavailable: "Couldn't save right now. Try again in a moment.",
      version_limit:
        "This strategy has reached 100 versions. Create a new strategy to keep changing it.",
    },
    versions: { title: "Versions", createdAt: "Created" },
  },
  comparators: { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "==": "=", "!=": "≠" },
  priceFields: {
    open: "Open",
    high: "High",
    low: "Low",
    close: "Close",
    tradedQuantity: "Traded quantity",
  },
  indicatorKinds: { sma: "SMA", ema: "EMA", rsi: "RSI", atr: "ATR", iv_rank: "IV rank" },
  operandKinds: { indicator: "Indicator", price: "Price field", constant: "Constant" },
  active: {
    label: "Active",
    hint: "Evaluated every night over your watchlist.",
    error: "Couldn't update. Try again.",
  },
  inbox: {
    overline: "Signals",
    title: "Inbox",
    columns: {
      strategy: "Strategy",
      instrument: "Instrument",
      evaluatedAt: "Evaluated at",
      proposal: "Proposal",
    },
    kind: { entry: "Entry", exit: "Exit", adjust: "Adjust" },
    late: "late",
    markRead: "Mark as read",
    read: "Read",
    entryProposalLegs: (legs: number) => `${String(legs)} leg(s)`,
    entryProposalNetPremiumLabel: "net premium",
    entryProposalCostLabel: "entry cost",
    exitProposal: "Exit condition met on an open operation",
    adjustProposal: "Adjustment condition met",
    evaluationLog: {
      title: "Evaluation log",
      empty: "No evaluation recorded yet.",
      reasonText: reasonTextEn,
      webReasonText: webReasonTextEn,
    },
    outcomes: {
      signal: "Signal",
      conditions_not_met: "Conditions not met",
      no_series_match: "No series match",
      degenerate_strikes: "Degenerate strikes",
      insufficient_data: "Insufficient data",
      unsizeable: "Unsizeable",
    },
  },
};

const ptBR = {
  list: {
    overline: "Estratégias",
    title: "Estratégias",
    newStrategy: "Nova estratégia",
    mine: {
      title: "Minhas estratégias",
      empty: "Nenhuma estratégia no catálogo ainda. Crie uma a partir de uma estrutura.",
      columns: {
        name: "Nome",
        visibility: "Visibilidade",
        version: "Versão",
        updatedAt: "Atualizada em",
      },
      edit: "Editar",
      share: "Compartilhar",
      unshare: "Parar de compartilhar",
      shareError: "Não foi possível atualizar o compartilhamento. Tente novamente.",
      active: "Ativa",
    },
    shared: {
      title: "Compartilhadas",
      empty: "Nenhuma estratégia compartilhada ainda.",
      copy: "Copiar",
      copyError: "Não foi possível copiar a estratégia. Tente novamente.",
    },
    visibility: { private: "Privada", shared: "Compartilhada" },
    emptyCatalog: "O catálogo de estruturas ainda não foi carregado.",
  },
  editor: {
    createOverline: "Nova estratégia",
    editOverline: "Editar estratégia",
    name: { label: "Nome" },
    timeframe: { label: "Escala de tempo" },
    structure: { label: "Estrutura" },
    entry: {
      title: "Condições de entrada",
      subtitle: "Todas as condições devem valer (E).",
      addCondition: "Adicionar condição",
      removeCondition: "Remover condição",
      comparator: "Comparador",
      leftOperand: "Primeiro valor",
      rightOperand: "Segundo valor",
      readOnlyNotice:
        "Essa condição combina e/ou/não de um jeito que o editor ainda não consegue mostrar em linhas. Ela é mantida sem alteração.",
    },
    operand: {
      kind: "Tipo",
      indicatorKind: "Indicador",
      indicatorLength: "Período",
      indicatorLookback: "Sessões de referência",
      priceField: "Campo",
      constantValue: "Valor",
    },
    strikes: {
      title: "Seleção de strikes",
      subtitle: "Uma linha por strike, em ordem de ranking.",
      addStrike: "Adicionar strike",
      removeStrike: "Remover strike",
      kind: "Método",
      kinds: { delta: "Delta", moneyness: "Moneyness", nearest: "Mais próximo" },
      delta: { target: "Delta alvo" },
      moneyness: { percent: "Moneyness (%)" },
      nearest: { price: "Preço de referência" },
    },
    expiry: {
      title: "Janela de vencimento",
      min: "Mínimo de sessões",
      max: "Máximo de sessões",
    },
    sizing: {
      title: "Dimensionamento",
      kind: "Método",
      fraction: "Fração",
      fixed_fractional: "Fração fixa",
      fixed_risk: "Risco fixo",
    },
    exit: {
      title: "Regras de saída",
      addRule: "Adicionar regra",
      removeRule: "Remover regra",
      kind: "Tipo",
      profit_target: "Alvo de lucro",
      stop_loss: "Stop",
      days_before_expiry: "Dias antes do vencimento",
      condition: "Condição",
      fractionOfPremium: "Fração do prêmio",
      multipleOfMaxLoss: "Múltiplo da perda máxima",
      businessDays: "Dias úteis",
      readOnlyNotice:
        "Essa condição de saída combina e/ou/não de um jeito que o editor ainda não consegue mostrar em linhas. Ela é mantida sem alteração.",
    },
    adjustments: {
      title: "Ajustes",
      subtitle: "Rolls para novo vencimento e novos strikes (opcional).",
      addAdjustment: "Adicionar ajuste",
      removeAdjustment: "Remover ajuste",
      when: "Rolar quando",
    },
    submit: { create: "Criar estratégia", save: "Salvar nova versão" },
    cancel: "Cancelar",
    invalid: "Alguns campos estão inválidos. Revise os valores antes de salvar.",
    fieldInvalid: "Valor inválido",
    errors: {
      invalid: "Alguns campos estão inválidos. Revise os valores antes de salvar.",
      not_found: "Essa estratégia não existe mais.",
      not_shared: "Essa estratégia não está compartilhada.",
      conflict: "Outra pessoa alterou esta estratégia. Recarregue e tente novamente.",
      unavailable: "Não conseguimos salvar agora. Tente novamente.",
      version_limit:
        "Esta estratégia chegou a 100 versões. Crie uma nova estratégia para continuar alterando.",
    },
    versions: { title: "Versões", createdAt: "Criada em" },
  },
  comparators: { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "==": "=", "!=": "≠" },
  priceFields: {
    open: "Abertura",
    high: "Máxima",
    low: "Mínima",
    close: "Fechamento",
    tradedQuantity: "Quantidade negociada",
  },
  indicatorKinds: {
    sma: "Média móvel simples",
    ema: "Média móvel exponencial",
    rsi: "IFR",
    atr: "ATR",
    iv_rank: "Ranking de IV",
  },
  operandKinds: { indicator: "Indicador", price: "Campo de preço", constant: "Constante" },
  active: {
    label: "Ativa",
    hint: "Avaliada todas as noites na sua watchlist.",
    error: "Não foi possível atualizar. Tente novamente.",
  },
  inbox: {
    overline: "Sinais",
    title: "Caixa de entrada",
    columns: {
      strategy: "Estratégia",
      instrument: "Ativo",
      evaluatedAt: "Avaliado em",
      proposal: "Proposta",
    },
    kind: { entry: "Entrada", exit: "Saída", adjust: "Ajuste" },
    late: "atrasado",
    markRead: "Marcar como lida",
    read: "Lida",
    entryProposalLegs: (legs: number) => `${String(legs)} ponta(s)`,
    entryProposalNetPremiumLabel: "prêmio líquido",
    entryProposalCostLabel: "custo da entrada",
    exitProposal: "Condição de saída atingida em uma operação em aberto",
    adjustProposal: "Condição de ajuste atingida",
    evaluationLog: {
      title: "Log de avaliações",
      empty: "Nenhuma avaliação registrada ainda.",
      reasonText: reasonTextPtBR,
      webReasonText: webReasonTextPtBR,
    },
    outcomes: {
      signal: "Sinal",
      conditions_not_met: "Condições não atendidas",
      no_series_match: "Nenhuma série correspondente",
      degenerate_strikes: "Strikes degenerados",
      insufficient_data: "Dados insuficientes",
      unsizeable: "Não dimensionável",
    },
  },
} satisfies typeof en;

export const strategiesStrings = { en, ptBR } as const;

export const t = strategiesStrings.ptBR;

// Composes one evaluation log row's label: the outcome label alone, or the
// outcome label followed by whatever extra its `reason` adds — an engine
// code through `reasonText` (`null` for `signal`/`conditions_not_met`,
// which add nothing beyond their own outcome label), a web-authored code
// through `webReasonText`, fed the row's own `detail` parameter. A row with
// no `reason` at all (pre-#80, or a web-authored failure `evaluate-signals.ts`
// never gave one of the four typed codes) renders the bare outcome label
// (#133: `detailFor`'s exact-sentence fallback is gone).
export function evaluationLabel(row: {
  outcome: EvaluationOutcome;
  reason: EvaluationReason | WebEvaluationReason | null;
  detail: string | null;
}): string {
  const outcomeLabel = t.inbox.outcomes[row.outcome];
  const suffix =
    row.reason === null
      ? undefined
      : isWebEvaluationReason(row.reason)
        ? t.inbox.evaluationLog.webReasonText[row.reason](row.detail)
        : (t.inbox.evaluationLog.reasonText[row.reason] ?? undefined);
  return suffix ? `${outcomeLabel} · ${suffix}` : outcomeLabel;
}
