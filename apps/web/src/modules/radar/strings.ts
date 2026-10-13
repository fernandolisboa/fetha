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
} satisfies typeof en;

export const radarStrings = { en, ptBR } as const;

export const t = radarStrings.ptBR;
