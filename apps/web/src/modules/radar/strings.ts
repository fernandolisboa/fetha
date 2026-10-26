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
    subtitle: (date: string) =>
      `From the radar at the close of ${date}, priced for one standard lot (100 per leg).`,
    order: "Ordered by how many option series traded at the close, never by a score.",
    footnote:
      "Fetha suggests from its recipes' rules, its models and past data. A suggestion can be wrong; the decision, and any order at your broker, is yours.",
    none: "No recipe found an entry at the latest close.",
    notRun: "The radar has not run yet. Suggestions show up after its first night.",
    more: (count: number) => `See all ${String(count)} suggestions in the radar`,
    headline: {
      "bull-call-spread-low-iv": (ticker: string) => `A bull call spread on ${ticker} fits now.`,
      "long-call-low-iv": (ticker: string) => `Buying a call on ${ticker} fits now.`,
      "bull-put-spread-high-iv": (ticker: string) => `A bull put spread on ${ticker} fits now.`,
      "covered-call-high-iv": (ticker: string) => `A covered call on ${ticker} fits now.`,
      "bear-put-spread-low-iv": (ticker: string) => `A bear put spread on ${ticker} fits now.`,
      "long-put-low-iv": (ticker: string) => `Buying a put on ${ticker} fits now.`,
      "bear-call-spread-high-iv": (ticker: string) => `A bear call spread on ${ticker} fits now.`,
      "call-butterfly": (ticker: string) => `A call butterfly on ${ticker} fits now.`,
      "long-straddle-low-iv": (ticker: string) => `A long straddle on ${ticker} fits now.`,
      "long-strangle-low-iv": (ticker: string) => `A long strangle on ${ticker} fits now.`,
    },
    fallbackHeadline: (structure: string, ticker: string) => `${structure} on ${ticker} fits now.`,
    why: (recipe: string) => `The recipe ${recipe} found an entry at the close:`,
    legsLabel: "The lot",
    legPrice: (price: string) => `at ${price}`,
    numbersLabel: "The engine's numbers for the lot",
    numbers: {
      netPremium: "Premium",
      maxLoss: "Max loss",
      maxGain: "Max gain",
      breakEvens: "Break-even",
      unbounded: "Unbounded",
      delta: "Delta",
      gamma: "Gamma",
      theta: "Theta / session",
      vega: "Vega / point",
    },
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
    },
    answered: (kind: string, date: string) => `Your decision: ${kind} · ${date}`,
    archived: (session: string, day: string) =>
      `The suggestions from the close of ${session} were archived at the end of ${day}. New ones show up here once the radar reads the next close.`,
    archivedCard: (day: string) =>
      `Archived at the end of ${day}: it no longer takes decisions. It is still scored at expiry.`,
  },
  research: {
    button: "Get suggestions",
    pending: "Researching…",
    hint: (sessions: number) =>
      `Re-checks what the radar found over its last ${String(sessions)} sessions against the latest close and your risk limits. Nothing is saved.`,
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
    openThrough: (date: string) => `Open through ${date}`,
    archived: (date: string) => `Was open through ${date}`,
    lot: "One standard lot",
    notesTitle: "How to read a suggestion",
    notes: [
      "The lot is one standard B3 lot: 100 per leg for each unit of the structure. Sizing it to your capital is up to you, in the builder.",
      "Premium is what you pay (negative) or receive (positive, with +) to set it up, at the closing prices the radar read. Tomorrow's prices will differ.",
      "Max loss and max gain are at expiry, before costs. The break-even is the underlying's price at expiry where the result is zero.",
      "The thesis is what Fetha scores at expiry: it shows up in the journal, under Fetha's suggestions, as right or wrong, with the result of the lot.",
      "Your limits are checked against the risk profile you declared in Settings and the operations you have open now.",
      "A suggestion is open until the end of the day (Brasília time) of the trading session after the close the radar read. Then it is archived: it leaves today's suggestions and takes no more decisions, but it is still scored at expiry.",
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
    subtitle: (date: string) =>
      `Do radar do fechamento de ${date}, com preço para um lote padrão (100 por perna).`,
    order:
      "Ordenadas pela quantidade de séries de opções negociadas no fechamento, nunca por nota.",
    footnote:
      "O Fetha sugere a partir das regras das receitas, dos modelos e de dados passados. Uma sugestão pode errar; a decisão, e qualquer ordem na corretora, é sua.",
    none: "Nenhuma receita encontrou entrada no último fechamento.",
    notRun: "O radar ainda não rodou. As sugestões aparecem depois da primeira noite.",
    more: (count: number) => `Ver as ${String(count)} sugestões no radar`,
    headline: {
      "bull-call-spread-low-iv": (ticker: string) =>
        `Uma trava de alta com calls em ${ticker} cabe agora.`,
      "long-call-low-iv": (ticker: string) => `Uma compra de call em ${ticker} cabe agora.`,
      "bull-put-spread-high-iv": (ticker: string) =>
        `Uma trava de alta com puts em ${ticker} cabe agora.`,
      "covered-call-high-iv": (ticker: string) => `Um lançamento coberto em ${ticker} cabe agora.`,
      "bear-put-spread-low-iv": (ticker: string) =>
        `Uma trava de baixa com puts em ${ticker} cabe agora.`,
      "long-put-low-iv": (ticker: string) => `Uma compra de put em ${ticker} cabe agora.`,
      "bear-call-spread-high-iv": (ticker: string) =>
        `Uma trava de baixa com calls em ${ticker} cabe agora.`,
      "call-butterfly": (ticker: string) => `Uma borboleta com calls em ${ticker} cabe agora.`,
      "long-straddle-low-iv": (ticker: string) => `Um straddle comprado em ${ticker} cabe agora.`,
      "long-strangle-low-iv": (ticker: string) => `Um strangle comprado em ${ticker} cabe agora.`,
    },
    fallbackHeadline: (structure: string, ticker: string) =>
      `${structure} em ${ticker} cabe agora.`,
    why: (recipe: string) => `A receita ${recipe} encontrou entrada no fechamento:`,
    legsLabel: "O lote",
    legPrice: (price: string) => `a ${price}`,
    numbersLabel: "Os números do motor para o lote",
    numbers: {
      netPremium: "Prêmio",
      maxLoss: "Perda máxima",
      maxGain: "Ganho máximo",
      breakEvens: "Break-even",
      unbounded: "Ilimitado",
      delta: "Delta",
      gamma: "Gama",
      theta: "Theta / sessão",
      vega: "Vega / ponto",
    },
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
    },
    answered: (kind: string, date: string) => `Sua decisão: ${kind} · ${date}`,
    archived: (session: string, day: string) =>
      `As sugestões do fechamento de ${session} foram arquivadas no fim do dia ${day}. As novas aparecem aqui assim que o radar ler o próximo fechamento.`,
    archivedCard: (day: string) =>
      `Arquivada no fim do dia ${day}: não recebe mais decisões. Ela continua sendo avaliada no vencimento.`,
  },
  research: {
    button: "Obter sugestões",
    pending: "Pesquisando…",
    hint: (sessions: number) =>
      `Confere o que o radar encontrou nos últimos ${String(sessions)} pregões com o fechamento mais recente e com os seus limites de risco. Nada fica salvo.`,
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
    openThrough: (date: string) => `Vale até ${date}`,
    archived: (date: string) => `Valia até ${date}`,
    lot: "Um lote padrão",
    notesTitle: "Como ler uma sugestão",
    notes: [
      "O lote é um lote padrão da B3: 100 por perna para cada unidade da estrutura. Ajustar o tamanho ao seu capital fica com você, no simulador.",
      "O prêmio é o que você paga (negativo) ou recebe (positivo, com +) para montar, aos preços de fechamento que o radar leu. Os preços de amanhã serão outros.",
      "Perda máxima e ganho máximo valem para o vencimento, antes dos custos. O break-even é o preço do ativo no vencimento em que o resultado fica zero.",
      "A tese é o que o Fetha confere no vencimento: ela aparece no diário, em Sugestões do Fetha, como acerto ou erro, com o resultado do lote.",
      "Os seus limites são conferidos com o perfil de risco que você declarou em Configurações e com as operações que você tem abertas agora.",
      "Uma sugestão vale até o fim do dia do pregão seguinte ao fechamento que o radar leu, no horário de Brasília. Depois disso, ela é arquivada: sai das sugestões de hoje e não recebe mais decisões, mas continua sendo avaliada no vencimento.",
    ],
  },
} satisfies typeof en;

export const radarStrings = { en, ptBR } as const;

export const t = radarStrings.ptBR;
