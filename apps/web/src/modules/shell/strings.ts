const en = {
  wordmark: "Fetha",
  search: {
    placeholder: "Search instrument, series or strategy",
    shortcut: "Ctrl K",
    empty: "Nothing to search yet.",
  },
  marketBar: {
    noData: "no data yet",
    closeFreshnessToday: "today's close",
    closeFreshnessYesterday: "yesterday's close",
    closeFreshnessOlder: (date: string) => `close on ${date}`,
  },
  rail: {
    navigationLabel: "Main navigation",
    collapse: "Collapse the navigation",
    expand: "Expand the navigation",
    declaredCapital: "Declared capital",
    capitalNotDeclared: "not declared",
  },
  destinations: {
    watchlist: "Watchlist",
    signals: "Signals",
    strategies: "Strategies",
    portfolio: "Portfolio",
    journal: "Journal",
    settings: "Settings",
  },
  accountMenu: {
    open: "Account menu",
  },
  emptyStates: {
    watchlist: {
      sentence: "No instrument in your watchlist yet.",
    },
    signals: {
      sentence: "No signal in your inbox yet.",
    },
    strategies: {
      sentence: "No strategy in your catalog yet.",
    },
    portfolio: {
      sentence: "No open position yet.",
    },
    journal: {
      sentence: "No decision recorded yet.",
    },
  },
};

const ptBR = {
  wordmark: "Fetha",
  search: {
    placeholder: "Buscar ativo, série ou estratégia",
    shortcut: "Ctrl K",
    empty: "Ainda não há nada para buscar.",
  },
  marketBar: {
    noData: "sem dados",
    closeFreshnessToday: "fechamento de hoje",
    closeFreshnessYesterday: "fechamento de ontem",
    closeFreshnessOlder: (date: string) => `fechamento de ${date}`,
  },
  rail: {
    navigationLabel: "Navegação principal",
    collapse: "Recolher a navegação",
    expand: "Expandir a navegação",
    declaredCapital: "Capital declarado",
    capitalNotDeclared: "não declarado",
  },
  destinations: {
    watchlist: "Watchlist",
    signals: "Sinais",
    strategies: "Estratégias",
    portfolio: "Carteira",
    journal: "Diário",
    settings: "Configurações",
  },
  accountMenu: {
    open: "Menu da conta",
  },
  emptyStates: {
    watchlist: {
      sentence: "Você ainda não tem nenhum ativo na watchlist.",
    },
    signals: {
      sentence: "Nenhum sinal na sua caixa de entrada ainda.",
    },
    strategies: {
      sentence: "Você ainda não tem nenhuma estratégia no catálogo.",
    },
    portfolio: {
      sentence: "Nenhuma posição em aberto ainda.",
    },
    journal: {
      sentence: "Nenhuma decisão registrada ainda.",
    },
  },
} satisfies typeof en;

export const shellStrings = { en, ptBR } as const;

export const t = shellStrings.ptBR;
