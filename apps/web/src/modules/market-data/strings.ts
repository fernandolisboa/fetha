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
  corporateActionPanel: {
    title: "Corporate-action factors",
    subtitle:
      "Type each split, reverse split or bonus from the company's own public notice. To correct a mistaken entry, enter the same ticker and ex-date again; 1 to 1 cancels it.",
    tickerLabel: "Ticker",
    exDateLabel: "Ex-date",
    sharesBeforeLabel: "From N shares",
    sharesAfterLabel: "to M shares",
    submit: "Save factor",
    saving: "Saving…",
    forbidden: "You are not allowed to do this.",
    invalidInput: "Check the ticker, ex-date and share counts.",
    notATradingSession: "That ex-date is not a trading session in the calendar (from 2024 on).",
    unknownTicker: "No candle is stored for that ticker yet.",
    unexpectedError: "Something went wrong; try again.",
    saved: (ratio: string, factor: string) => `Saved ${ratio}: factor ${factor}.`,
    listTitle: "Recorded factors",
    listEmpty: "No factor recorded yet.",
    ratio: (sharesBefore: number, sharesAfter: number) =>
      `${String(sharesBefore)} to ${String(sharesAfter)}`,
    factorColumn: "Factor",
    recordedAtColumn: "Recorded at",
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
  corporateActionPanel: {
    title: "Fatores de evento corporativo",
    subtitle:
      "Digite cada desdobramento, grupamento ou bonificação a partir do aviso público da empresa. Para corrigir um lançamento errado, informe o mesmo ticker e a mesma data-ex de novo; 1 para 1 cancela o lançamento.",
    tickerLabel: "Ticker",
    exDateLabel: "Data-ex",
    sharesBeforeLabel: "De N ações",
    sharesAfterLabel: "para M ações",
    submit: "Salvar fator",
    saving: "Salvando…",
    forbidden: "Você não tem permissão para fazer isso.",
    invalidInput: "Confira o ticker, a data-ex e as quantidades de ações.",
    notATradingSession: "Essa data-ex não é um pregão no calendário (a partir de 2024).",
    unknownTicker: "Ainda não há candle registrado para esse ticker.",
    unexpectedError: "Algo deu errado; tente de novo.",
    saved: (ratio: string, factor: string) => `${ratio} salvo: fator ${factor}.`,
    listTitle: "Fatores registrados",
    listEmpty: "Nenhum fator registrado ainda.",
    ratio: (sharesBefore: number, sharesAfter: number) =>
      `${String(sharesBefore)} para ${String(sharesAfter)}`,
    factorColumn: "Fator",
    recordedAtColumn: "Registrado em",
  },
} satisfies typeof en;

export const marketDataStrings = { en, ptBR } as const;

export const t = marketDataStrings.ptBR;
