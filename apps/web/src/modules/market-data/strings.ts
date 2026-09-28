const en = {
  instrument: {
    overline: "Instrument",
    adjusted: "Adjusted",
    nominal: "Nominal",
    volume: "Volume",
    noData: "No candle for this instrument yet.",
    unavailable: "Couldn't load the chart. Try again.",
  },
  optionSeries: {
    overline: "Option series",
    right: { call: "Call", put: "Put" },
    style: { american: "American", european: "European" },
    strike: (strike: string) => `Strike ${strike}`,
    expires: (date: string) => `Expires ${date}`,
    expired: (date: string) => `Expired ${date}`,
    openUnderlying: (underlying: string) => `Open ${underlying}`,
    prices: {
      title: "Recent sessions",
      subtitle: "Daily data from B3's COTAHIST file.",
      session: "Session",
      close: "Close",
      average: "Average",
      trades: "Trades",
      noTrades: "no trades",
      empty: "No session recorded for this series yet.",
    },
  },
};

const ptBR = {
  instrument: {
    overline: "Ativo",
    adjusted: "Ajustada",
    nominal: "Nominal",
    volume: "Volume",
    noData: "Ainda não há candle para este ativo.",
    unavailable: "Não foi possível carregar o gráfico. Tente novamente.",
  },
  optionSeries: {
    overline: "Série de opção",
    right: { call: "Call", put: "Put" },
    style: { american: "Americana", european: "Europeia" },
    strike: (strike: string) => `Strike ${strike}`,
    expires: (date: string) => `Vence em ${date}`,
    expired: (date: string) => `Venceu em ${date}`,
    openUnderlying: (underlying: string) => `Ver ${underlying}`,
    prices: {
      title: "Últimos pregões",
      subtitle: "Dados diários do arquivo COTAHIST da B3.",
      session: "Pregão",
      close: "Fechamento",
      average: "Preço médio",
      trades: "Negócios",
      noTrades: "sem negócios",
      empty: "Ainda não há pregão registrado para esta série.",
    },
  },
} satisfies typeof en;

export const marketDataStrings = { en, ptBR } as const;

export const t = marketDataStrings.ptBR;
