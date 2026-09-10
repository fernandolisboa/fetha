const en = {
  page: {
    overline: "Watchlist",
    title: "Watchlist",
  },
  add: {
    trigger: "Add instrument",
    placeholder: "Search by ticker",
    empty: "No instrument found.",
    error: "Couldn't add the instrument. Try again.",
  },
  remove: {
    action: "Remove",
    error: "Couldn't remove the instrument. Try again.",
  },
  table: {
    columns: { ticker: "Ticker", lastClose: "Last close", session: "Session" },
    noClose: "no close yet",
  },
  instrument: {
    overline: "Instrument",
    adjusted: "Adjusted",
    nominal: "Nominal",
    volume: "Volume",
    noData: "No candle for this instrument yet.",
    unavailable: "Couldn't load the chart. Try again.",
  },
};

const ptBR = {
  page: {
    overline: "Watchlist",
    title: "Watchlist",
  },
  add: {
    trigger: "Adicionar ativo",
    placeholder: "Buscar pelo código",
    empty: "Nenhum ativo encontrado.",
    error: "Não foi possível adicionar o ativo. Tente novamente.",
  },
  remove: {
    action: "Remover",
    error: "Não foi possível remover o ativo. Tente novamente.",
  },
  table: {
    columns: { ticker: "Código", lastClose: "Último fechamento", session: "Pregão" },
    noClose: "sem fechamento ainda",
  },
  instrument: {
    overline: "Ativo",
    adjusted: "Ajustada",
    nominal: "Nominal",
    volume: "Volume",
    noData: "Ainda não há candle para este ativo.",
    unavailable: "Não foi possível carregar o gráfico. Tente novamente.",
  },
} satisfies typeof en;

export const watchlistStrings = { en, ptBR } as const;

export const t = watchlistStrings.ptBR;
