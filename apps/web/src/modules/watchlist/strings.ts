const en = {
  page: {
    overline: "Watchlist",
    title: "Watchlist",
  },
  tabs: { watchlist: "Watchlist", radar: "Radar" },
  add: {
    trigger: "Add instrument",
    placeholder: "Search by ticker",
    empty: "No instrument found.",
    searching: "Searching…",
    searchError: "Couldn't search instruments. Try again.",
    rateLimited: "Too many searches in a row. Wait a few seconds and try again.",
    error: "Couldn't add the instrument. Try again.",
    cap: "Your watchlist is full (100 instruments). Remove one to add another.",
  },
  remove: {
    action: "Remove",
    error: "Couldn't remove the instrument. Try again.",
  },
  table: {
    columns: {
      ticker: "Ticker",
      reading: "Reading",
      lastClose: "Last close",
      trend: "30 sessions",
      session: "Session",
    },
    sparklineLabel: (ticker: string, sessions: number) =>
      `${ticker} closes over the last ${String(sessions)} sessions`,
    noClose: "no close yet",
    noStrategy:
      "No active strategy looks at these assets. The reading works without one; an active strategy adds the nightly signals.",
    strategiesLink: "See strategies",
  },
  nextSteps: {
    title: "Next steps",
    subtitle: "Three ways to go from here. A strategy is optional.",
    follow: {
      title: "Keep following",
      onWatchlist: "It's on your watchlist: the reading refreshes after every close.",
      notOnWatchlist: "Add it to your watchlist to see its reading there after every close.",
      add: "Add to watchlist",
    },
    study: {
      title: "Study an operation",
      body: (ticker: string) =>
        `Open the builder with ${ticker} filled in, pick a structure and see max loss, max gain and break-evens before deciding.`,
      action: "Open the builder",
    },
    recipe: {
      title: "Use a ready recipe",
      body: "Ready-made strategies chosen by what you expect from the asset, backtested on it in one click.",
      action: "Choose a recipe",
    },
    strategy: {
      active:
        "An active strategy already looks at this asset every night: when its conditions match, a signal shows up in Signals.",
      notWatched:
        "Your active strategies only look at assets on your watchlist; add this one for them to evaluate it every night.",
      none: "No active strategy looks at this asset. That's fine: the reading above doesn't need one. An active strategy adds a nightly evaluation that raises a signal in Signals when its conditions match.",
      action: "See strategies",
    },
  },
};

const ptBR = {
  page: {
    overline: "Watchlist",
    title: "Watchlist",
  },
  tabs: { watchlist: "Watchlist", radar: "Radar" },
  add: {
    trigger: "Adicionar ativo",
    placeholder: "Buscar pelo código",
    empty: "Nenhum ativo encontrado.",
    searching: "Buscando…",
    searchError: "Não foi possível buscar ativos. Tente novamente.",
    rateLimited: "Muitas buscas seguidas. Espere alguns segundos e tente de novo.",
    error: "Não foi possível adicionar o ativo. Tente novamente.",
    cap: "Sua watchlist está cheia (100 ativos). Remova um para adicionar outro.",
  },
  remove: {
    action: "Remover",
    error: "Não foi possível remover o ativo. Tente novamente.",
  },
  table: {
    columns: {
      ticker: "Código",
      reading: "Leitura",
      lastClose: "Último fechamento",
      trend: "30 pregões",
      session: "Pregão",
    },
    sparklineLabel: (ticker: string, sessions: number) =>
      `Fechamentos de ${ticker} nos últimos ${String(sessions)} pregões`,
    noClose: "sem fechamento ainda",
    noStrategy:
      "Nenhuma estratégia ativa olha estes ativos. A leitura funciona sem estratégia; uma estratégia ativa acrescenta os sinais noturnos.",
    strategiesLink: "Ver estratégias",
  },
  nextSteps: {
    title: "Próximos passos",
    subtitle: "Três caminhos a partir daqui. Ter uma estratégia é opcional.",
    follow: {
      title: "Continuar acompanhando",
      onWatchlist: "Está na sua watchlist: a leitura se atualiza a cada fechamento.",
      notOnWatchlist: "Adicione à watchlist para ver a leitura dele lá a cada fechamento.",
      add: "Adicionar à watchlist",
    },
    study: {
      title: "Estudar uma operação",
      body: (ticker: string) =>
        `Abra o montador já com ${ticker} preenchido, escolha uma estrutura e veja perda máxima, ganho máximo e pontos de equilíbrio antes de decidir.`,
      action: "Abrir o montador",
    },
    recipe: {
      title: "Usar uma receita pronta",
      body: "Estratégias prontas escolhidas pelo que você espera do ativo, com backtest nele em um clique.",
      action: "Escolher uma receita",
    },
    strategy: {
      active:
        "Uma estratégia ativa já olha este ativo toda noite: quando as condições dela batem, aparece um sinal em Sinais.",
      notWatched:
        "Suas estratégias ativas só olham os ativos da watchlist; adicione este para que elas o avaliem toda noite.",
      none: "Nenhuma estratégia ativa olha este ativo. Tudo bem: a leitura acima não depende de uma. Uma estratégia ativa acrescenta a avaliação noturna, que gera um sinal em Sinais quando as condições dela batem.",
      action: "Ver estratégias",
    },
  },
} satisfies typeof en;

export const watchlistStrings = { en, ptBR } as const;

export const t = watchlistStrings.ptBR;
