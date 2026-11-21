const en = {
  panel: {
    intro:
      "Every night, after the close, the radar reads each underlying with liquid options against the ready-made recipes. Listed here are the ones where a recipe found an entry, with the readings that matched.",
    notRun: "The radar has not run yet. It runs every night after the data ingestion.",
    session: (date: string, scanned: number, universe: number) =>
      `Close of ${date} · ${String(scanned)} of ${String(universe)} underlyings read`,
    pending: (count: number) =>
      `${String(count)} ${count === 1 ? "underlying was" : "underlyings were"} not read at this close yet; the next run picks up where this one stopped.`,
    none: (date: string) => `No recipe found an entry at the close of ${date}.`,
    order: "Ordered by how many option series traded at the close.",
  },
  table: {
    columns: { ticker: "Ticker", reading: "Reading", recipes: "Recipe", options: "Options" },
    found: (recipe: string) => `The recipe ${recipe} found an entry`,
    tradedSeries: (count: number) => `${String(count)} series traded`,
    onWatchlist: "On your watchlist",
    seeRecipes: "See recipes",
    factsLabel: "Readings that matched",
    legsLabel: "What one unit would be",
  },
  facts: {
    close: "Close",
    sma: (length: number) => `${String(length)}-session average`,
    ema: (length: number) => `${String(length)}-session exponential average`,
    rsi: (length: number) => `RSI ${String(length)}`,
    atr: (length: number) => `ATR ${String(length)}`,
    iv_rank: (sessions: number) => `IV rank (${String(sessions)} sessions)`,
    missing: "n/a",
  },
  legs: {
    side: { buy: "Buy", sell: "Sell" },
    role: { stock: "stock", call: "call", put: "put" },
    strike: (strike: string) => `strike ${strike}`,
    expiry: (date: string) => `expires ${date}`,
  },
  suggestions: {
    title: "Today's suggestions",
    cardTitle: (structure: string, ticker: string) => `${structure} on ${ticker}`,
    eyebrow: (date: string, recipe: string) => `Radar · close of ${date} · recipe ${recipe}`,
    scenario: {
      up: "Scenario: up",
      down: "Scenario: down",
      sideways: "Scenario: price stays put",
      big_move: "Scenario: a strong move",
    },
    expiresChip: (date: string) => `Expires ${date}`,
    debitChip: "Debit",
    creditChip: "Credit",
    sentence: {
      between: (
        pay: string,
        gainClause: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        lossClause: string,
      ) =>
        `You pay ${pay} and gain ${gainClause} if ${ticker} closes between ${lower} and ${upper} on ${date}. Outside that range, you lose ${lossClause}.`,
      outside: (
        pay: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        lossClause: string,
      ) =>
        `You pay ${pay} and gain if ${ticker} closes below ${lower} or above ${upper} on ${date}. Between the two, you lose ${lossClause}.`,
      above: (
        pay: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossClause: string,
      ) =>
        `You pay ${pay} and gain if ${ticker} closes above ${level} on ${date}, ${gainClause}. Below that, you lose ${lossClause}.`,
      below: (
        pay: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossClause: string,
      ) =>
        `You pay ${pay} and gain if ${ticker} closes below ${level} on ${date}, ${gainClause}. Above that, you lose ${lossClause}.`,
      betweenGain: (
        opening: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} and profit if ${ticker} closes between ${lower} and ${upper} on ${date}, ${gainClause}. Outside that range, you can lose ${lossPhrase}.`,
      outsideGain: (
        opening: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} and profit if ${ticker} closes below ${lower} or above ${upper} on ${date}, ${gainClause}. Between the two, you can lose ${lossPhrase}.`,
      aboveGain: (
        opening: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} and profit if ${ticker} closes above ${level} on ${date}, ${gainClause}. Below that, you can lose ${lossPhrase}.`,
      belowGain: (
        opening: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} and profit if ${ticker} closes below ${level} on ${date}, ${gainClause}. Above that, you can lose ${lossPhrase}.`,
      openingCredit: (receive: string) => `You receive ${receive} now`,
      openingNeutral: "You set this up at no cost",
      coveredCall: (pay: string, ticker: string, level: string, date: string, maxGain: string) =>
        `You pay ${pay} for the stock, net of what you receive for the call, and gain up to ${maxGain} if ${ticker} closes above ${level} on ${date}. Below ${level}, you are at a loss.`,
      fallbackDebit: (pay: string, gainPhraseCap: string, lossPhrase: string) =>
        `You pay ${pay}. ${gainPhraseCap}, ${lossPhrase}.`,
      fallbackCredit: (receive: string, gainPhraseCap: string, lossPhrase: string) =>
        `You receive ${receive} now. ${gainPhraseCap}, ${lossPhrase}.`,
      fallbackNeutral: (gainPhraseCap: string, lossPhrase: string) =>
        `You set this up at no cost. ${gainPhraseCap}, ${lossPhrase}.`,
      lossClauseEqual: (pay: string) => `up to the ${pay} you paid`,
      lossUpTo: (amount: string) => `up to ${amount}`,
      unboundedLoss: "with no limit",
      gainUpTo: (amount: string) => `up to ${amount}`,
      unboundedGain: "with no limit on the gain",
      fallbackGainUpTo: (amount: string) => `Gains up to ${amount}`,
      fallbackUnboundedGain: "Gains with no limit",
      fallbackLossUpTo: (amount: string) => `loses up to ${amount}`,
      fallbackUnboundedLoss: "loses with no limit",
      fallbackLossUpToCredit: (amount: string) => `can lose up to ${amount}`,
      fallbackUnboundedLossCredit: "can lose with no limit",
    },
    figures: {
      risked: "At risk",
      riskedHint: "worst case",
      gainUpTo: "Gain up to",
      gainUnbounded: "No limit",
      gainToRisk: "Gain ÷ risk",
      gainToRiskHint: "best case",
    },
    whyTitle: "Why now",
    legsTable: {
      title: "How to set it up (1 lot)",
      operation: "Operation",
      quantity: "Qty",
      strike: "Strike",
      price: "Price",
      expiry: "Expiry",
      allExpire: (date: string) => `All expire on ${date}.`,
      optionsExpire: (date: string) => `The options expire on ${date}.`,
    },
    detailsTitle: "Details",
    learnStructure: (name: string) => `Learn: ${name}`,
    greeks: {
      theta: { label: "Time", small: "theta" },
      vega: { label: "Volatility", small: "vega" },
      delta: { label: "Direction", small: "delta" },
      gamma: { label: "Acceleration", small: "gamma" },
      history: { label: "History", small: "this recipe" },
      incomplete: "Incomplete greeks: one leg had no volatility to compute them with.",
    },
    greekSentence: {
      thetaPositive: (amount: string) =>
        `Working for you: ${amount} per session, if the price stays put.`,
      thetaNegative: (amount: string) =>
        `Working against you: ${amount} per session, if the price stays put.`,
      thetaNeutral: "Has no effect if the price stays put.",
      vegaPositive: (amount: string) =>
        `Working for you: ${amount} for every point implied volatility rises.`,
      vegaNegative: (amount: string) =>
        `Working against you: ${amount} for every point implied volatility rises.`,
      vegaNeutral: "Has no effect from a change in implied volatility.",
      deltaBought: (shares: string) => `The lot behaves like ${shares} shares bought.`,
      deltaSold: (shares: string) => `The lot behaves like ${shares} shares sold.`,
      deltaNeutral: "The lot does not move with the price.",
      gammaPositive: (shares: string) =>
        `For every R$ 1 rise, delta goes up by about ${shares} shares (and down the same on a fall).`,
      gammaNegative: (shares: string) =>
        `For every R$ 1 rise, delta goes down by about ${shares} shares (and up the same on a fall).`,
      gammaNeutral: "The delta barely changes when the price moves.",
      recipeHistory: (held: number, claimed: number) =>
        `Got it right ${String(held)} of ${String(claimed)} suggestions already expired.`,
    },
    chartSpot: (price: string) => `Close ${price}`,
    subtitle: (date: string) =>
      `From the radar at the close of ${date}, priced for one standard lot (100 per leg).`,
    order: "Ordered by how many option series traded at the close, never by a score.",
    footnote:
      "Fetha suggests from its recipes' rules, its models and past data. A suggestion can be wrong; the decision, and any order at your broker, is yours.",
    none: "No recipe found an entry at the latest close.",
    notRun: "The radar has not run yet. Suggestions show up after its first night.",
    more: (count: number) => `See all ${String(count)} suggestions in the radar`,
    overdue: (count: number) =>
      count === 1
        ? "The radar has not read the next close yet. Today's prices may have moved."
        : `The radar has not read the next ${String(count)} closes yet. Today's prices may have moved.`,
    numbersLabel: "The engine's numbers for the lot",
    claim: {
      close_above: (ticker: string, level: string, date: string) =>
        `The thesis: ${ticker} closes above ${level} on ${date}.`,
      close_below: (ticker: string, level: string, date: string) =>
        `The thesis: ${ticker} closes below ${level} on ${date}.`,
      operation_pnl_positive: (date: string) =>
        `The thesis: the operation ends with a profit on ${date}.`,
    },
    noRiskProfile: "Declare your capital in Settings to check this lot against your limits.",
    withinLimits: "Within your risk limits.",
    actions: {
      recipe: "See the recipe",
      builder: "Study in the builder",
      plan: "Build plan",
    },
    moreOfStructure: (structureName: string, count: number) =>
      `More of the ${structureName} structure (${String(count)})`,
    answered: (kind: string, date: string) => `Your decision: ${kind} · ${date}`,
    archivedCard: (session: string) =>
      `Archived: the radar has read the close of ${session} since. It no longer takes decisions, but it is still scored at expiry.`,
    seenArchive: {
      allArchived:
        "You have already seen every suggestion from this close, and they left this panel after the time you chose.",
      archivedTitle: "Seen, archived for you",
      on: (delay: string) =>
        `Suggestions you have seen leave this panel ${delay} after the first time.`,
      off: "Suggestions you have seen stay on this panel.",
      adjust: "Change",
    },
  },
  research: {
    button: "Get suggestions",
    holdingTitle: "Still valid today",
    noLongerTitle: "No longer valid",
    summary: (candidates: number, sessions: number) =>
      `Looked at ${String(candidates)} ${candidates === 1 ? "idea" : "ideas"} from ${String(sessions)} ${sessions === 1 ? "session" : "sessions"}`,
    droppedTotal: (count: number) => `; ${String(count)} dropped: `,
    dropped: {
      unpriced: (count: number) => `${String(count)} with no price today`,
      expires_too_soon: (count: number, sessions: number) =>
        `${String(count)} ${count === 1 ? "expires" : "expire"} in fewer than ${String(sessions)} sessions`,
      exceeds_capital: (count: number) => `${String(count)} with a loss above your capital`,
      not_evaluable: (count: number) => `${String(count)} without data to check the rule today`,
    },
    empty: (sessions: number) =>
      `No idea from the last ${String(sessions)} sessions is valid today.`,
    noRadar: "The radar has not read a session yet.",
    timedOut:
      "The research stopped at its time limit and only looked at part of the ideas. Try again.",
    defaultProfile: (capital: string) =>
      `You have not declared a risk profile, so I used the default one (capital of ${capital}).`,
    declareProfile: "Declare yours in Settings",
    close: (date: string) => `Prices from the close of ${date}`,
    cardTitle: (structure: string, ticker: string) => `${structure} on ${ticker}`,
    foundOn: (date: string) => `The radar found it at the close of ${date}.`,
    expires: (date: string, sessions: number) =>
      `Expires ${date}, in ${String(sessions)} ${sessions === 1 ? "session" : "sessions"}`,
    alertsLabel: "Alerts",
    alerts: {
      rule_no_longer_holds: (date: string) =>
        `The recipe's rule no longer holds: it found an entry at the close of ${date}, but not today.`,
      near_expiry: (sessions: number) =>
        `Expires in ${String(sessions)} ${sessions === 1 ? "session" : "sessions"}: little time left for it to work out.`,
    },
    actions: { suggestion: "See the original suggestion", asset: "See the asset" },
    errors: {
      rate_limited: "Too many researches in a short time. Try again in a minute.",
      unavailable: "I could not research right now. Try again in a moment.",
    },
  },
  calibration: {
    title: "Fetha's suggestions",
    subtitle:
      "How the suggestions did at their expiry: the share whose thesis held and the result of one lot, entered at the close the radar read, after B3 costs. The same for everyone.",
    empty: "No suggestion has reached its expiry yet.",
    columns: { recipe: "Recipe", scored: "Scored", held: "Thesis held", pnl: "Result per lot" },
    held: (held: number, claimed: number) => `${String(held)} of ${String(claimed)}`,
    all: "All recipes",
  },
  page: {
    overline: (date: string) => `Suggestion · close of ${date}`,
    expires: (date: string) => `Expires ${date}`,
    current: "Open",
    archived: (session: string) => `Archived since the close of ${session}`,
    lot: "One standard lot",
    notesTitle: "How to read a suggestion",
    notes: [
      "The lot is one standard B3 lot: 100 per leg for each unit of the structure. Sizing it to your capital is up to you, in the builder.",
      "Premium is what you pay (negative) or receive (positive, with +) to set it up, at the closing prices the radar read. Tomorrow's prices will differ.",
      "Max loss and max gain are at expiry, before costs. The break-even is the underlying's price at expiry where the result is zero.",
      "The thesis is what Fetha scores at expiry: it shows up in the journal, under Fetha's suggestions, as right or wrong, with the result of the lot.",
      "Your limits are checked against the risk profile you declared in Settings and the operations you have open now.",
      "A suggestion stays open until the radar reads a newer close. Then it is archived: it leaves today's suggestions and takes no more decisions, but it is still scored at expiry. If ingestion falls behind, it stays here with a note on how many closes the radar has not read yet.",
    ],
  },
};

const ptBR = {
  panel: {
    intro:
      "Toda noite, depois do fechamento, o radar lê cada ativo com opções líquidas e confere as receitas prontas. Aqui aparecem os ativos em que alguma receita encontrou entrada, com as leituras que bateram.",
    notRun: "O radar ainda não rodou. Ele roda toda noite, depois da ingestão dos dados.",
    session: (date: string, scanned: number, universe: number) =>
      `Fechamento de ${date} · ${String(scanned)} de ${String(universe)} ativos lidos`,
    pending: (count: number) =>
      `${String(count)} ${count === 1 ? "ativo ainda não foi lido" : "ativos ainda não foram lidos"} neste fechamento; a próxima execução continua de onde parou.`,
    none: (date: string) => `Nenhuma receita encontrou entrada no fechamento de ${date}.`,
    order: "Ordenados pela quantidade de séries de opções negociadas no fechamento.",
  },
  table: {
    columns: { ticker: "Código", reading: "Leitura", recipes: "Receita", options: "Opções" },
    found: (recipe: string) => `A receita ${recipe} encontrou entrada`,
    tradedSeries: (count: number) =>
      `${String(count)} ${count === 1 ? "série negociada" : "séries negociadas"}`,
    onWatchlist: "Na sua watchlist",
    seeRecipes: "Ver receitas",
    factsLabel: "Leituras que bateram",
    legsLabel: "Como fica uma unidade",
  },
  facts: {
    close: "Fechamento",
    sma: (length: number) => `Média de ${String(length)} sessões`,
    ema: (length: number) => `Média exponencial de ${String(length)} sessões`,
    rsi: (length: number) => `RSI ${String(length)}`,
    atr: (length: number) => `ATR ${String(length)}`,
    iv_rank: (sessions: number) => `Ranking de IV (${String(sessions)} sessões)`,
    missing: "sem dado",
  },
  legs: {
    side: { buy: "Compra", sell: "Venda" },
    role: { stock: "ação", call: "call", put: "put" },
    strike: (strike: string) => `strike ${strike}`,
    expiry: (date: string) => `vence ${date}`,
  },
  suggestions: {
    title: "Sugestões de hoje",
    chartSpot: (price: string) => `Fechamento ${price}`,
    subtitle: (date: string) =>
      `Do radar do fechamento de ${date}, com preço para um lote padrão (100 por perna).`,
    order:
      "Ordenadas pela quantidade de séries de opções negociadas no fechamento, nunca por nota.",
    footnote:
      "O Fetha sugere a partir das regras das receitas, dos modelos e de dados passados. Uma sugestão pode errar; a decisão, e qualquer ordem na corretora, é sua.",
    none: "Nenhuma receita encontrou entrada no último fechamento.",
    notRun: "O radar ainda não rodou. As sugestões aparecem depois da primeira noite.",
    more: (count: number) => `Ver as ${String(count)} sugestões no radar`,
    overdue: (count: number) =>
      count === 1
        ? "O radar ainda não leu o fechamento seguinte. Os preços de hoje podem ter mudado."
        : `O radar ainda não leu os ${String(count)} fechamentos seguintes. Os preços de hoje podem ter mudado.`,
    cardTitle: (structure: string, ticker: string) => `${structure} em ${ticker}`,
    eyebrow: (date: string, recipe: string) => `Radar · fechamento de ${date} · receita ${recipe}`,
    scenario: {
      up: "Cenário: alta",
      down: "Cenário: queda",
      sideways: "Cenário: preço parado",
      big_move: "Cenário: movimento forte",
    },
    expiresChip: (date: string) => `Vence ${date}`,
    debitChip: "Débito",
    creditChip: "Crédito",
    sentence: {
      between: (
        pay: string,
        gainClause: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        lossClause: string,
      ) =>
        `Você paga ${pay} e ganha ${gainClause} se ${ticker} fechar entre ${lower} e ${upper} em ${date}. Fora dessa faixa, perde ${lossClause}.`,
      outside: (
        pay: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        lossClause: string,
      ) =>
        `Você paga ${pay} e ganha se ${ticker} fechar abaixo de ${lower} ou acima de ${upper} em ${date}. Entre os dois, perde ${lossClause}.`,
      above: (
        pay: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossClause: string,
      ) =>
        `Você paga ${pay} e ganha se ${ticker} fechar acima de ${level} em ${date}, ${gainClause}. Abaixo disso, perde ${lossClause}.`,
      below: (
        pay: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossClause: string,
      ) =>
        `Você paga ${pay} e ganha se ${ticker} fechar abaixo de ${level} em ${date}, ${gainClause}. Acima disso, perde ${lossClause}.`,
      betweenGain: (
        opening: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} e lucra se ${ticker} fechar entre ${lower} e ${upper} em ${date}, ${gainClause}. Fora dessa faixa, pode perder ${lossPhrase}.`,
      outsideGain: (
        opening: string,
        ticker: string,
        lower: string,
        upper: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} e lucra se ${ticker} fechar abaixo de ${lower} ou acima de ${upper} em ${date}, ${gainClause}. Entre os dois, pode perder ${lossPhrase}.`,
      aboveGain: (
        opening: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} e lucra se ${ticker} fechar acima de ${level} em ${date}, ${gainClause}. Abaixo disso, pode perder ${lossPhrase}.`,
      belowGain: (
        opening: string,
        ticker: string,
        level: string,
        date: string,
        gainClause: string,
        lossPhrase: string,
      ) =>
        `${opening} e lucra se ${ticker} fechar abaixo de ${level} em ${date}, ${gainClause}. Acima disso, pode perder ${lossPhrase}.`,
      openingCredit: (receive: string) => `Você recebe ${receive} agora`,
      openingNeutral: "Você monta essa posição sem custo",
      coveredCall: (pay: string, ticker: string, level: string, date: string, maxGain: string) =>
        `Você paga ${pay} pelas ações, já descontado o que recebe pela call, e ganha até ${maxGain} se ${ticker} fechar acima de ${level} em ${date}. Abaixo de ${level}, fica no prejuízo.`,
      fallbackDebit: (pay: string, gainPhraseCap: string, lossPhrase: string) =>
        `Você paga ${pay}. ${gainPhraseCap}, ${lossPhrase}.`,
      fallbackCredit: (receive: string, gainPhraseCap: string, lossPhrase: string) =>
        `Você recebe ${receive} agora. ${gainPhraseCap}, ${lossPhrase}.`,
      fallbackNeutral: (gainPhraseCap: string, lossPhrase: string) =>
        `Você monta essa posição sem custo. ${gainPhraseCap}, ${lossPhrase}.`,
      lossClauseEqual: (pay: string) => `até os ${pay} que pagou`,
      lossUpTo: (amount: string) => `até ${amount}`,
      unboundedLoss: "sem limite",
      gainUpTo: (amount: string) => `até ${amount}`,
      unboundedGain: "sem limite de ganho",
      fallbackGainUpTo: (amount: string) => `Ganha até ${amount}`,
      fallbackUnboundedGain: "Ganha sem limite",
      fallbackLossUpTo: (amount: string) => `perde até ${amount}`,
      fallbackUnboundedLoss: "perde sem limite",
      fallbackLossUpToCredit: (amount: string) => `pode perder até ${amount}`,
      fallbackUnboundedLossCredit: "pode perder sem limite",
    },
    figures: {
      risked: "Arrisca",
      riskedHint: "pior caso",
      gainUpTo: "Ganha até",
      gainUnbounded: "Sem limite",
      gainToRisk: "Ganho ÷ risco",
      gainToRiskHint: "no melhor cenário",
    },
    whyTitle: "Por que agora",
    legsTable: {
      title: "Como montar (1 lote)",
      operation: "Operação",
      quantity: "Qtd",
      strike: "Strike",
      price: "Preço",
      expiry: "Vencimento",
      allExpire: (date: string) => `Todas vencem em ${date}.`,
      optionsExpire: (date: string) => `As opções vencem em ${date}.`,
    },
    detailsTitle: "Detalhes",
    learnStructure: (name: string) => `Aprender: ${name}`,
    greeks: {
      theta: { label: "Tempo", small: "theta" },
      vega: { label: "Volatilidade", small: "vega" },
      delta: { label: "Direção", small: "delta" },
      gamma: { label: "Aceleração", small: "gama" },
      history: { label: "Histórico", small: "esta receita" },
      incomplete: "Gregas incompletas: uma perna ficou sem volatilidade calculada.",
    },
    greekSentence: {
      thetaPositive: (amount: string) =>
        `Joga a seu favor: ${amount} por pregão, se o preço ficar parado.`,
      thetaNegative: (amount: string) =>
        `Joga contra: ${amount} por pregão, se o preço ficar parado.`,
      thetaNeutral: "Não faz diferença se o preço ficar parado.",
      vegaPositive: (amount: string) =>
        `Joga a seu favor: ${amount} para cada ponto que a volatilidade implícita subir.`,
      vegaNegative: (amount: string) =>
        `Joga contra: ${amount} para cada ponto que a volatilidade implícita subir.`,
      vegaNeutral: "Não faz diferença se a volatilidade implícita mudar.",
      deltaBought: (shares: string) => `O lote se comporta como ${shares} ações compradas.`,
      deltaSold: (shares: string) => `O lote se comporta como ${shares} ações vendidas.`,
      deltaNeutral: "O lote não se move com o preço.",
      gammaPositive: (shares: string) =>
        `A cada R$ 1 de alta, o delta sobe cerca de ${shares} ações (e cai o mesmo na baixa).`,
      gammaNegative: (shares: string) =>
        `A cada R$ 1 de alta, o delta cai cerca de ${shares} ações (e sobe o mesmo na baixa).`,
      gammaNeutral: "O delta quase não muda quando o preço se move.",
      recipeHistory: (held: number, claimed: number) =>
        `Acertou ${String(held)} de ${String(claimed)} sugestões já vencidas.`,
    },
    numbersLabel: "Os números do motor para o lote",
    claim: {
      close_above: (ticker: string, level: string, date: string) =>
        `A tese: ${ticker} fecha acima de ${level} em ${date}.`,
      close_below: (ticker: string, level: string, date: string) =>
        `A tese: ${ticker} fecha abaixo de ${level} em ${date}.`,
      operation_pnl_positive: (date: string) => `A tese: a operação termina no lucro em ${date}.`,
    },
    noRiskProfile:
      "Declare seu capital em Configurações para conferir este lote com os seus limites.",
    withinLimits: "Dentro dos seus limites de risco.",
    actions: {
      recipe: "Ver receita",
      builder: "Montar no simulador",
      plan: "Montar plano",
    },
    moreOfStructure: (structureName: string, count: number) =>
      `Mais da estrutura ${structureName} (${String(count)})`,
    answered: (kind: string, date: string) => `Sua decisão: ${kind} · ${date}`,
    archivedCard: (session: string) =>
      `Arquivada: o radar já leu o fechamento de ${session}. Ela não recebe mais decisões, mas continua sendo avaliada no vencimento.`,
    seenArchive: {
      allArchived:
        "Você já viu todas as sugestões deste fechamento, e elas saíram daqui depois do tempo que você escolheu.",
      archivedTitle: "Já vistas, arquivadas para você",
      on: (delay: string) =>
        `As sugestões que você já viu saem daqui ${delay} depois da primeira vez.`,
      off: "As sugestões que você já viu continuam aqui.",
      adjust: "Ajustar",
    },
  },
  research: {
    button: "Obter sugestões",
    holdingTitle: "Ainda valem hoje",
    noLongerTitle: "Deixaram de valer",
    summary: (candidates: number, sessions: number) =>
      `Olhei ${String(candidates)} ${candidates === 1 ? "ideia" : "ideias"} de ${String(sessions)} ${sessions === 1 ? "pregão" : "pregões"}`,
    droppedTotal: (count: number) =>
      `; ${String(count)} ${count === 1 ? "descartada" : "descartadas"}: `,
    dropped: {
      unpriced: (count: number) => `${String(count)} sem preço hoje`,
      expires_too_soon: (count: number, sessions: number) =>
        `${String(count)} ${count === 1 ? "vence" : "vencem"} em menos de ${String(sessions)} pregões`,
      exceeds_capital: (count: number) =>
        `${String(count)} ${count === 1 ? "perda maior" : "perdas maiores"} que o seu capital`,
      not_evaluable: (count: number) => `${String(count)} sem dados para avaliar a regra hoje`,
    },
    empty: (sessions: number) => `Nenhuma ideia dos últimos ${String(sessions)} pregões vale hoje.`,
    noRadar: "O radar ainda não leu nenhum pregão.",
    timedOut: "A pesquisa parou no limite de tempo e olhou só parte das ideias. Tente de novo.",
    defaultProfile: (capital: string) =>
      `Você ainda não declarou um perfil de risco, então usei o padrão (capital de ${capital}).`,
    declareProfile: "Declare o seu em Configurações",
    close: (date: string) => `Preços do fechamento de ${date}`,
    cardTitle: (structure: string, ticker: string) => `${structure} em ${ticker}`,
    foundOn: (date: string) => `O radar achou no fechamento de ${date}.`,
    expires: (date: string, sessions: number) =>
      `Vence em ${date}, daqui a ${String(sessions)} ${sessions === 1 ? "pregão" : "pregões"}`,
    alertsLabel: "Alertas",
    alerts: {
      rule_no_longer_holds: (date: string) =>
        `A regra da receita deixou de valer: ela encontrou entrada no fechamento de ${date}, mas hoje não.`,
      near_expiry: (sessions: number) =>
        `Vence em ${String(sessions)} ${sessions === 1 ? "pregão" : "pregões"}: pouco tempo para dar certo.`,
    },
    actions: { suggestion: "Ver a sugestão original", asset: "Ver o ativo" },
    errors: {
      rate_limited: "Pesquisas demais em pouco tempo. Tente de novo daqui a um minuto.",
      unavailable: "Não consegui pesquisar agora. Tente de novo daqui a pouco.",
    },
  },
  calibration: {
    title: "Sugestões do Fetha",
    subtitle:
      "Como as sugestões se saíram no vencimento: quantas tiveram a tese confirmada e o resultado de um lote, comprado no fechamento que o radar leu, já com os custos da B3. É igual para todo mundo.",
    empty: "Nenhuma sugestão chegou ao vencimento ainda.",
    columns: {
      recipe: "Receita",
      scored: "Avaliadas",
      held: "Tese confirmada",
      pnl: "Resultado por lote",
    },
    held: (held: number, claimed: number) => `${String(held)} de ${String(claimed)}`,
    all: "Todas as receitas",
  },
  page: {
    overline: (date: string) => `Sugestão · fechamento de ${date}`,
    expires: (date: string) => `Vence em ${date}`,
    current: "Em aberto",
    archived: (session: string) => `Arquivada desde o fechamento de ${session}`,
    lot: "Um lote padrão",
    notesTitle: "Como ler uma sugestão",
    notes: [
      "O lote é um lote padrão da B3: 100 por perna para cada unidade da estrutura. Ajustar o tamanho ao seu capital fica com você, no simulador.",
      "O prêmio é o que você paga (negativo) ou recebe (positivo, com +) para montar, aos preços de fechamento que o radar leu. Os preços de amanhã serão outros.",
      "Perda máxima e ganho máximo valem para o vencimento, antes dos custos. O break-even é o preço do ativo no vencimento em que o resultado fica zero.",
      "A tese é o que o Fetha confere no vencimento: ela aparece no diário, em Sugestões do Fetha, como acerto ou erro, com o resultado do lote.",
      "Os seus limites são conferidos com o perfil de risco que você declarou em Configurações e com as operações que você tem abertas agora.",
      "Uma sugestão fica em aberto até o radar ler um fechamento mais novo. Aí ela é arquivada: sai das sugestões de hoje e não recebe mais decisões, mas continua sendo avaliada no vencimento. Se a ingestão atrasar, ela continua aqui com um aviso de quantos fechamentos o radar ainda não leu.",
    ],
  },
} satisfies typeof en;

export const radarStrings = { en, ptBR } as const;

export const t = radarStrings.ptBR;
