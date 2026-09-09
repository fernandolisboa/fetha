const en = {
  wordmark: "Fetha",
  search: {
    placeholder: "Search instrument, series or strategy",
    shortcut: "Ctrl K",
    empty: "Nothing to search yet.",
  },
  marketBar: {
    noData: "no data yet",
  },
  rail: {
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
    theme: "Theme",
  },
  emptyStates: {
    watchlist: {
      sentence: "No instrument in your watchlist yet.",
      action: "Add an instrument",
    },
    signals: {
      sentence: "No signal in your inbox yet.",
      action: "Add an instrument to the watchlist",
    },
    strategies: {
      sentence: "No strategy in your catalog yet.",
      action: "Browse the catalog",
    },
    portfolio: {
      sentence: "No open position yet.",
      action: "Import fills from the B3 investor area",
    },
    journal: {
      sentence: "No decision recorded yet.",
      action: "Record your first decision",
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
  },
  rail: {
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
    theme: "Tema",
  },
  emptyStates: {
    watchlist: {
      sentence: "Você ainda não tem nenhum ativo na watchlist.",
      action: "Adicionar ativo",
    },
    signals: {
      sentence: "Nenhum sinal na sua caixa de entrada ainda.",
      action: "Adicionar ativo à watchlist",
    },
    strategies: {
      sentence: "Você ainda não tem nenhuma estratégia no catálogo.",
      action: "Ver catálogo",
    },
    portfolio: {
      sentence: "Nenhuma posição em aberto ainda.",
      action: "Importar negociações da área do investidor B3",
    },
    journal: {
      sentence: "Nenhuma decisão registrada ainda.",
      action: "Registrar sua primeira decisão",
    },
  },
} satisfies typeof en;

export const shellStrings = { en, ptBR } as const;

export const t = shellStrings.ptBR;
