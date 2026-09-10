const en = {
  page: {
    overline: "Watchlist",
    title: "Watchlist",
  },
  add: {
    trigger: "Add instrument",
    placeholder: "Search by ticker",
    empty: "No instrument found.",
    searchError: "Couldn't search instruments. Try again.",
    error: "Couldn't add the instrument. Try again.",
    cap: "Your watchlist is full (100 instruments). Remove one to add another.",
  },
  remove: {
    action: "Remove",
    error: "Couldn't remove the instrument. Try again.",
  },
  table: {
    columns: { ticker: "Ticker", lastClose: "Last close", session: "Session" },
    noClose: "no close yet",
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
    searchError: "Não foi possível buscar ativos. Tente novamente.",
    error: "Não foi possível adicionar o ativo. Tente novamente.",
    cap: "Sua watchlist está cheia (100 ativos). Remova um para adicionar outro.",
  },
  remove: {
    action: "Remover",
    error: "Não foi possível remover o ativo. Tente novamente.",
  },
  table: {
    columns: { ticker: "Código", lastClose: "Último fechamento", session: "Pregão" },
    noClose: "sem fechamento ainda",
  },
} satisfies typeof en;

export const watchlistStrings = { en, ptBR } as const;

export const t = watchlistStrings.ptBR;
