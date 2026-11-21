const en = {
  summary: {
    fromView: {
      up: "Fetha built this {structure} on {ticker} because you expect it to rise and volatility is {ivRegime}.",
      down: "Fetha built this {structure} on {ticker} because you expect it to fall and volatility is {ivRegime}.",
      sideways:
        "Fetha built this {structure} on {ticker} because you expect it to move sideways and volatility is {ivRegime}.",
      unsure:
        "Fetha built this {structure} on {ticker} to fit the current, {ivRegime} volatility, since you have no view on direction.",
    },
    // No volatility reading at all (an asset with too little history, ticket #379): drops the
    // volatility clause entirely instead of naming it "any", which read as a literal,
    // nonsensical regime.
    fromViewNoIv: {
      up: "Fetha built this {structure} on {ticker} because you expect it to rise; there is not yet enough history to measure volatility.",
      down: "Fetha built this {structure} on {ticker} because you expect it to fall; there is not yet enough history to measure volatility.",
      sideways:
        "Fetha built this {structure} on {ticker} because you expect it to move sideways; there is not yet enough history to measure volatility.",
      unsure:
        "Fetha built this {structure} on {ticker} since you have no view on direction; there is not yet enough history to measure volatility.",
    },
    fromSuggestion: "Fetha built this {structure} on {ticker} from today's suggestion.",
    priceClose: (date: string) => ` Prices from the close on ${date}.`,
  },
  doesNotFit:
    "Even one lot of this {structure} loses more than your risk limit allows per operation; Fetha could not fit it.",
  ivRegimes: { low: "low", high: "high", normal: "normal", any: "any" },
  panel: { title: "Build a plan" },
  view: {
    question: "What do you expect from {ticker} in the coming weeks?",
    options: { up: "It rises", down: "It falls", sideways: "It stays flat", unsure: "Not sure" },
    submit: "Build plan",
  },
  screen: {
    title: "Operation plan",
    overline: "{ticker}",
    numbers: {
      maxLoss: "Max loss",
      maxGain: "Max gain",
      breakEvens: "Break-even(s)",
      cashToday: "Cash today",
      riskUsed: "Share of your risk limit",
      unbounded: "Unbounded",
    },
    orders: {
      title: "Orders",
      instrument: "Instrument",
      quantity: "Quantity",
      limitPrice: "Unit limit price",
      total: "Total",
      buy: "Buy",
      sell: "Sell",
      call: (underlying: string, strike: string, expiry: string) =>
        `Call on ${underlying}, strike ${strike}, expires ${expiry}`,
      put: (underlying: string, strike: string, expiry: string) =>
        `Put on ${underlying}, strike ${strike}, expires ${expiry}`,
      stock: (ticker: string) => `${ticker} shares`,
      seriesCode: (ticker: string) => `code ${ticker}`,
    },
    rules: {
      title: "Rules",
      rollLabel: "Roll",
      rollApplies: (date: string) => `Consider rolling from ${date}`,
      rollDoesNotApply: "This structure is not rolled",
    },
    save: "Save plan",
    saving: "Saving...",
    saved: "Plan saved.",
    goToPortfolio: "Go to your portfolio",
    doesNotFitTitle: "This plan does not fit your risk limit",
    errors: {
      invalid: "Could not build a plan for this request.",
      no_data: "There is not enough data to build a plan for this underlying today.",
      no_recipe: "The recipe book has no match for this view today.",
      unpriceable: "Fetha could not price this plan today.",
      does_not_fit: "Even one lot of this structure loses more than your risk limit allows.",
      stale_prices: "At least one leg's price is stale; Fetha will not build a plan on it.",
      no_market_price: "At least one leg has no market price today.",
      plan_changed: "This plan changed since you opened it; review it again.",
      rate_limited: "Too many plans built in a short time; try again shortly.",
      invalid_adjustment: "This edit no longer matches the structure; try a different strike.",
    },
    backToSuggestion: "Back to the suggestion",
  },
  adjust: {
    title: "Adjust the plan",
    roleNames: { call: "call", put: "put", stock: "stock" },
    strikeLabel: (side: string, role: string) => `${side} ${role}, strike`,
    decreaseStrike: "Lower strike",
    increaseStrike: "Raise strike",
    lotsLabel: "Lots",
    decreaseLots: "One fewer lot",
    increaseLots: "One more lot",
    expiryLabel: "Expiry",
    preview: "Previewing, not yet official.",
    whatChanged: {
      title: "What changed from Fetha's plan",
      none: "Nothing changed yet.",
      lots: (from: number, to: number) => `Lots: ${String(from)} → ${String(to)}`,
      leg: (side: string, role: string, from: string, to: string) =>
        `${side} ${role}: ${from} → ${to}`,
    },
    reset: "Back to Fetha's plan",
    adjusting: "Repricing...",
    errors: {
      adjust_failed: "Fetha could not reprice this edit; try again.",
      expiry_remap_failed:
        "Could not move every leg to that expiry; the plan stays on its current one.",
    },
  },
  execute: {
    button: "I executed it",
    executed: "Executed",
    dialogTitle: "Record the actual fills",
    instrument: "Instrument",
    side: "Side",
    quantity: "Quantity",
    price: "Fill price",
    costs: "Costs",
    date: "Date",
    submit: "Record fills",
    submitting: "Recording...",
    buy: "Buy",
    sell: "Sell",
    errors: {
      invalid_input: "Check the fields: at least one is invalid.",
      not_found: "This plan could not be found.",
      already_executed: "This plan was already executed.",
      unknown_instrument: "At least one instrument is unknown to the reference data.",
      index_stock_leg: "A market index cannot be recorded as a stock fill.",
      not_a_session: "That date has no open trading session yet.",
      rate_limited: "Too many fills recorded in a short time; try again shortly.",
      fills_unavailable: "At least one fill could not be grouped; try again.",
      operation_unavailable: "The target operation is no longer open.",
      empty: "No fills to group.",
      unknown_series: "At least one series is unknown to the reference data.",
      mixed_underlyings: "The fills do not all share the same underlying.",
      mixed_expiries: "The fills do not all share the same expiry.",
      unavailable: "Could not record the fills; try again.",
    },
  },
  signals: {
    panelTitle: "Plan alerts",
    empty: "No plan alert yet.",
    kinds: {
      target_hit: "Target hit",
      stop_hit: "Stop hit",
      roll_due: "Roll due",
      expiry_near: "Expiry near",
    },
    viewPortfolio: "View in the portfolio",
  },
} satisfies Record<string, unknown>;

const ptBR = {
  summary: {
    fromView: {
      up: "A Fetha montou essa {structure} em {ticker} porque você espera alta e a volatilidade está {ivRegime}.",
      down: "A Fetha montou essa {structure} em {ticker} porque você espera queda e a volatilidade está {ivRegime}.",
      sideways:
        "A Fetha montou essa {structure} em {ticker} porque você espera lateralização e a volatilidade está {ivRegime}.",
      unsure:
        "A Fetha montou essa {structure} em {ticker} para a volatilidade atual, {ivRegime}, já que você não tem uma visão de direção.",
    },
    fromViewNoIv: {
      up: "A Fetha montou essa {structure} em {ticker} porque você espera alta; ainda não há histórico suficiente para medir a volatilidade.",
      down: "A Fetha montou essa {structure} em {ticker} porque você espera queda; ainda não há histórico suficiente para medir a volatilidade.",
      sideways:
        "A Fetha montou essa {structure} em {ticker} porque você espera lateralização; ainda não há histórico suficiente para medir a volatilidade.",
      unsure:
        "A Fetha montou essa {structure} em {ticker} já que você não tem uma visão de direção; ainda não há histórico suficiente para medir a volatilidade.",
    },
    fromSuggestion: "A Fetha montou essa {structure} em {ticker} a partir da sugestão de hoje.",
    priceClose: (date: string) => ` Preços do fechamento de ${date}.`,
  },
  doesNotFit:
    "Mesmo um lote dessa {structure} perde mais do que o seu limite de risco permite por operação; a Fetha não conseguiu encaixar o plano.",
  ivRegimes: { low: "baixa", high: "alta", normal: "normal", any: "qualquer" },
  panel: { title: "Montar plano" },
  view: {
    question: "O que você espera de {ticker} nas próximas semanas?",
    options: { up: "Sobe", down: "Cai", sideways: "Fica de lado", unsure: "Não sei" },
    submit: "Montar plano",
  },
  screen: {
    title: "Plano de operação",
    overline: "{ticker}",
    numbers: {
      maxLoss: "Perda máxima",
      maxGain: "Ganho máximo",
      breakEvens: "Ponto(s) de equilíbrio",
      cashToday: "Caixa hoje",
      riskUsed: "Parte do seu limite de risco",
      unbounded: "Sem limite",
    },
    orders: {
      title: "Ordens",
      instrument: "Instrumento",
      quantity: "Quantidade",
      limitPrice: "Preço limite por unidade",
      total: "Total",
      buy: "Compra",
      sell: "Venda",
      call: (underlying: string, strike: string, expiry: string) =>
        `Call de ${underlying}, strike ${strike}, vence ${expiry}`,
      put: (underlying: string, strike: string, expiry: string) =>
        `Put de ${underlying}, strike ${strike}, vence ${expiry}`,
      stock: (ticker: string) => `Ações de ${ticker}`,
      seriesCode: (ticker: string) => `código ${ticker}`,
    },
    rules: {
      title: "Regras",
      rollLabel: "Rolagem",
      rollApplies: (date: string) => `Considere rolar a partir de ${date}`,
      rollDoesNotApply: "Essa estrutura não é rolada",
    },
    save: "Salvar plano",
    saving: "Salvando...",
    saved: "Plano salvo.",
    goToPortfolio: "Ir para a carteira",
    doesNotFitTitle: "Esse plano não cabe no seu limite de risco",
    errors: {
      invalid: "Não foi possível montar um plano para esse pedido.",
      no_data: "Não há dados suficientes para montar um plano desse ativo hoje.",
      no_recipe: "O receituário não tem uma receita para essa visão hoje.",
      unpriceable: "A Fetha não conseguiu precificar esse plano hoje.",
      does_not_fit: "Mesmo um lote dessa estrutura perde mais do que seu limite de risco permite.",
      stale_prices:
        "Pelo menos uma ponta está com preço desatualizado; a Fetha não monta o plano com ele.",
      no_market_price: "Pelo menos uma ponta não tem preço de mercado hoje.",
      plan_changed: "Esse plano mudou desde que você abriu; revise de novo.",
      rate_limited: "Muitos planos montados em pouco tempo; tente novamente em breve.",
      invalid_adjustment: "Esse ajuste não corresponde mais à estrutura; tente outro strike.",
    },
    backToSuggestion: "Voltar para a sugestão",
  },
  adjust: {
    title: "Ajustar o plano",
    roleNames: { call: "call", put: "put", stock: "ação" },
    strikeLabel: (side: string, role: string) => `${side} de ${role}, strike`,
    decreaseStrike: "Diminuir o strike",
    increaseStrike: "Aumentar o strike",
    lotsLabel: "Lotes",
    decreaseLots: "Um lote a menos",
    increaseLots: "Um lote a mais",
    expiryLabel: "Vencimento",
    preview: "Pré-visualização, ainda não é o valor oficial.",
    whatChanged: {
      title: "O que mudou em relação ao plano da Fetha",
      none: "Nada mudou ainda.",
      lots: (from: number, to: number) => `Lotes: ${String(from)} → ${String(to)}`,
      leg: (side: string, role: string, from: string, to: string) =>
        `${side} de ${role}: ${from} → ${to}`,
    },
    reset: "Voltar ao plano da Fetha",
    adjusting: "Reprecificando...",
    errors: {
      adjust_failed: "A Fetha não conseguiu reprecificar esse ajuste; tente de novo.",
      expiry_remap_failed:
        "Não foi possível mover todas as pontas para esse vencimento; o plano continua no vencimento atual.",
    },
  },
  execute: {
    button: "Executei",
    executed: "Executado",
    dialogTitle: "Registrar as execuções",
    instrument: "Instrumento",
    side: "Lado",
    quantity: "Quantidade",
    price: "Preço de execução",
    costs: "Custos",
    date: "Data",
    submit: "Registrar execuções",
    submitting: "Registrando...",
    buy: "Compra",
    sell: "Venda",
    errors: {
      invalid_input: "Confira os campos: pelo menos um está inválido.",
      not_found: "Esse plano não foi encontrado.",
      already_executed: "Esse plano já foi executado.",
      unknown_instrument: "Pelo menos um instrumento é desconhecido para os dados de referência.",
      index_stock_leg: "Um índice de mercado não pode ser registrado como execução de ação.",
      not_a_session: "Essa data ainda não teve um pregão aberto.",
      rate_limited: "Muitas execuções registradas em pouco tempo; tente novamente em breve.",
      fills_unavailable: "Pelo menos uma execução não pôde ser agrupada; tente de novo.",
      operation_unavailable: "A operação de destino não está mais aberta.",
      empty: "Nenhuma execução para agrupar.",
      unknown_series: "Pelo menos uma série é desconhecida para os dados de referência.",
      mixed_underlyings: "As execuções não compartilham o mesmo ativo-objeto.",
      mixed_expiries: "As execuções não compartilham o mesmo vencimento.",
      unavailable: "Não foi possível registrar as execuções; tente de novo.",
    },
  },
  signals: {
    panelTitle: "Alertas de planos",
    empty: "Nenhum alerta de plano ainda.",
    kinds: {
      target_hit: "Alvo atingido",
      stop_hit: "Stop atingido",
      roll_due: "Rolagem no prazo",
      expiry_near: "Vencimento próximo",
    },
    viewPortfolio: "Ver na carteira",
  },
} satisfies typeof en;

export const plansStrings = { en, ptBR } as const;

export const t = plansStrings.ptBR;
