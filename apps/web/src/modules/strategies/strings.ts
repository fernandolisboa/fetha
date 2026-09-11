// The engine (packages/engine, no i18n) emits an evaluation's `detail` as
// English prose from a closed, enumerable set of reasons (never a stable
// code, unlike `outcome`). These map the strings known at the time of
// writing; an unrecognized string is dropped rather than shown untranslated
// (CLAUDE.md i18n: user-facing strings ship in pt-BR). A follow-up ticket
// should have the engine emit a code instead.
const evaluationDetailEn: Record<string, string> = {
  "no candles for this instrument and timeframe": "No candles for this instrument and timeframe",
  "no candles in (since, at] for this instrument and timeframe":
    "No candles in the evaluated window for this instrument and timeframe",
  "entry condition needs more warm-up data": "Entry condition needs more warm-up data",
  "no listed option series satisfies the strike and expiry selection":
    "No listed option series satisfies the strike and expiry selection",
  "two distinct strike ranks resolved to the same listed strike":
    "Two distinct strike ranks resolved to the same listed strike",
  "no declared capital to size against": "No declared capital to size against",
  "fixed_risk sizing is unsizeable against an unbounded max loss":
    "Fixed-risk sizing is unsizeable against an unbounded max loss",
  "sizing yields fewer than one unit": "Sizing yields fewer than one unit",
  "not enough market data to select strikes or price the proposal":
    "Not enough market data to select strikes or price the proposal",
  "profit_target cannot fire: the operation's premium base is zero":
    "Profit target cannot fire: the operation's premium base is zero",
  "stop_loss cannot fire: the operation's max-loss base is zero":
    "Stop loss cannot fire: the operation's max-loss base is zero",
  // Codes evaluate-signals.ts writes itself, not engine prose (#19 round 3
  // item 7): distinct so the owner can tell a deleted structure from an
  // unfillable collection from a real engine failure, instead of all three
  // collapsing into the bare "Insufficient data" outcome label.
  unknown_structure: "The strategy's structure no longer exists in the catalog",
};

// `engine_error:<code>` and `catchup_clamped:<count>` carry a variable
// suffix (#19 round 3 items 2, 7), so they cannot be exact keys in the maps
// above: matched by prefix instead, in order, before falling back to
// undefined (rendered as nothing extra beyond the bare outcome label).
// The suffix names the actual `MarketViewCollection` that failed
// (`canSatisfyCollection`, market-data), but that identifier
// (`impliedVolatilityIndex`, and whatever else joins it later) is an
// internal name, not a user-facing one — the copy stays collection-neutral
// rather than naming a specific indicator, so a second member added to
// `UNSATISFIABLE_COLLECTIONS` is described correctly without a strings
// change (round 7 item 4: the old exact-key entry for
// `impliedVolatilityIndex` alone would have kept naming implied volatility
// even for a strategy that failed on an unrelated collection).
const evaluationDetailPrefixesEn: readonly (readonly [string, (suffix: string) => string])[] = [
  ["engine_error:", (code) => `Engine error (${code})`],
  ["catchup_clamped:", (count) => `Catch-up capped: ${count} older session(s) skipped`],
  [
    "unsatisfiable_collection:",
    () => "Requires market data with no source yet for one of this strategy's indicators",
  ],
];

const evaluationDetailPrefixesPtBR: readonly (readonly [string, (suffix: string) => string])[] = [
  ["engine_error:", (code) => `Erro do motor (${code})`],
  [
    "catchup_clamped:",
    (count) => `Atualização limitada: ${count} sessão(ões) mais antiga(s) ignorada(s)`,
  ],
  [
    "unsatisfiable_collection:",
    () => "Requer dados de mercado ainda sem fonte para um dos indicadores dessa estratégia",
  ],
];

function detailLookup(
  exact: Record<string, string>,
  prefixes: readonly (readonly [string, (suffix: string) => string])[],
): (detail: string) => string | undefined {
  return (detail: string): string | undefined => {
    if (detail in exact) {
      return exact[detail];
    }
    for (const [prefix, render] of prefixes) {
      if (detail.startsWith(prefix)) {
        return render(detail.slice(prefix.length));
      }
    }
    return undefined;
  };
}

const evaluationDetailPtBR: Record<string, string> = {
  "no candles for this instrument and timeframe":
    "Sem candles para este ativo nessa escala de tempo",
  "no candles in (since, at] for this instrument and timeframe":
    "Sem candles no intervalo avaliado para este ativo nessa escala de tempo",
  "entry condition needs more warm-up data":
    "A condição de entrada precisa de mais histórico de aquecimento",
  "no listed option series satisfies the strike and expiry selection":
    "Nenhuma série de opção listada atende à seleção de strike e vencimento",
  "two distinct strike ranks resolved to the same listed strike":
    "Dois ranks de strike distintos resolveram para o mesmo strike listado",
  "no declared capital to size against": "Sem capital declarado para dimensionar",
  "fixed_risk sizing is unsizeable against an unbounded max loss":
    "Dimensionamento por risco fixo não é possível com perda máxima ilimitada",
  "sizing yields fewer than one unit": "O dimensionamento resulta em menos de uma unidade",
  "not enough market data to select strikes or price the proposal":
    "Dados de mercado insuficientes para selecionar strikes ou precificar a proposta",
  "profit_target cannot fire: the operation's premium base is zero":
    "O alvo de lucro não pode disparar: a base de prêmio da operação é zero",
  "stop_loss cannot fire: the operation's max-loss base is zero":
    "O stop não pode disparar: a base de perda máxima da operação é zero",
  unknown_structure: "A estrutura da estratégia não existe mais no catálogo",
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
      detail: evaluationDetailEn,
      detailFor: detailLookup(evaluationDetailEn, evaluationDetailPrefixesEn),
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
      detail: evaluationDetailPtBR,
      detailFor: detailLookup(evaluationDetailPtBR, evaluationDetailPrefixesPtBR),
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
