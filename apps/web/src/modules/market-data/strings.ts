const en = {
  reading: {
    title: "Asset reading",
    subtitle: (session: string) =>
      `Computed by the engine from the ${session} close. Templated sentences, no AI.`,
    noSession: "No close for this asset yet, so there is nothing to read.",
    unavailable: "Couldn't compute the reading. Try again later.",
    chipsLabel: "Reading",
    trend: {
      name: "Trend",
      label: { up: "Uptrend", down: "Downtrend", sideways: "No clear trend" },
      chip: { up: "up", down: "down", sideways: "sideways" },
      sentence: {
        up: "The price closed above its 50-session average, and that average is above the 200-session one: the classic uptrend shape.",
        down: "The price closed below its 50-session average, and that average is below the 200-session one: the classic downtrend shape.",
        sideways:
          "Price and its 50- and 200-session averages don't line up in one direction: the asset is moving sideways or changing course.",
      },
      missing: "The trend needs a candle in each of the last 200 sessions, and some are missing.",
      detail: (smaShort: string, smaLong: string) => `SMA 50 ${smaShort} · SMA 200 ${smaLong}`,
    },
    momentum: {
      name: "Momentum (RSI 14)",
      label: { oversold: "Oversold", neutral: "Neutral", overbought: "Overbought" },
      sentence: {
        oversold: (rsi: string) =>
          `RSI is ${rsi}, at 30 or below: recent falls were strong, and a bounce sometimes follows.`,
        neutral: (rsi: string) =>
          `RSI is ${rsi}, between 30 and 70: neither buying nor selling has been excessive.`,
        overbought: (rsi: string) =>
          `RSI is ${rsi}, at 70 or above: recent gains were strong, and a pullback sometimes follows.`,
      },
      missing: "Not enough sessions yet to compute the RSI.",
    },
    range: {
      name: "Daily range (ATR 14)",
      label: { calm: "Calm", normal: "Normal", wide: "Wide" },
      sentence: {
        calm: (atr: string, share: string) =>
          `On average it moves ${atr} a day (${share} of the price), up to 1.5%: short moves.`,
        normal: (atr: string, share: string) =>
          `On average it moves ${atr} a day (${share} of the price), between 1.5% and 3.5%.`,
        wide: (atr: string, share: string) =>
          `On average it moves ${atr} a day (${share} of the price), 3.5% or more: wide moves, so structures with a capped loss fit better.`,
      },
      missing: "Not enough sessions yet to compute the ATR.",
    },
    impliedVolatility: {
      name: "Implied volatility",
      label: { low: "Cheap options", normal: "Usual options", high: "Expensive options" },
      chip: { low: "IV low", normal: "IV normal", high: "IV high" },
      sentence: {
        low: (iv: string, rank: string) =>
          `Implied volatility is ${iv}, IV rank ${rank}: among the lowest of the last year. Options are relatively cheap, which favors buying options or debit spreads.`,
        normal: (iv: string, rank: string) =>
          `Implied volatility is ${iv}, IV rank ${rank}: within its usual range of the last year.`,
        high: (iv: string, rank: string) =>
          `Implied volatility is ${iv}, IV rank ${rank}: among the highest of the last year. Options are relatively expensive, which favors selling options or credit spreads.`,
      },
      noRank: (iv: string) =>
        `Implied volatility is ${iv}; saying whether that is high or low takes a point in each of the last 252 sessions, and some are missing.`,
      missing: "No implied-volatility index for this asset yet: it needs traded options.",
    },
    options: {
      name: "Options",
      label: { liquid: "Liquid options", thin: "Few options traded", none: "No options traded" },
      chip: "options",
      chipTitle: "Liquid options",
      sentence: {
        liquid: (count: number, session: string) =>
          `${String(count)} option series traded in the ${session} session.`,
        thin: (count: number, session: string) =>
          `Only ${String(count)} option series traded in the ${session} session. Building an operation may be hard: check each series' trades first.`,
        none: (session: string) =>
          `No option series of this asset traded in the ${session} session.`,
      },
      notListed: "This asset has no listed options at B3.",
      expiriesTitle: "Next expiries",
      expiry: (date: string, series: number, traded: number) =>
        `${date} · ${String(series)} series, ${String(traded)} traded`,
    },
  },
  instrument: {
    overline: "Instrument",
    adjusted: "Adjusted",
    nominal: "Nominal",
    volume: "Volume",
    noData: "No candle for this instrument yet.",
    unavailable: "Couldn't load the chart. Try again.",
  },
  marketIndex: {
    chipLabel: "Ibovespa",
    chipUnit: "Closing level, in points",
    chipSource: "B3",
    noData: "No close for the Ibovespa yet.",
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
    history: {
      title: "Price and volatility history",
      subtitle: (sessions: number) =>
        `Last ${String(sessions)} sessions with a record. Implied volatility is solved by the engine from each session's close (Black-Scholes).`,
      seriesClose: "Series close",
      underlyingClose: (underlying: string) => `${underlying} close`,
      impliedVolatility: "Implied volatility",
      noValue: "no value",
      volatilityUnavailable: "Not enough data to solve the implied volatility on these sessions.",
    },
  },
  exchangeRate: {
    overline: "Exchange rate",
    pairLabel: { USDBRL: "Dollar", EURBRL: "Euro" },
    chipPtax: "PTAX selling rate",
    chipSource: "Banco Central (Bacen)",
    note: "PTAX is the Central Bank's daily fixing, published around 1pm on Bacen's own business-day calendar; it is not a market close.",
    lastRate: (date: string) => `Last PTAX, ${date}`,
    noData: "No PTAX point for this pair yet.",
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
  companyFilings: {
    title: "Recent events",
    subtitle:
      "Material facts, market notices, shareholder notices and meetings filed with the CVM. Source: CVM open data (ODbL).",
    deliveredUntilToday: "CVM data up to today.",
    deliveredUntilYesterday: "CVM data up to yesterday.",
    deliveredUntil: (date: string) => `CVM data up to ${date}.`,
    deliveredOn: "Filed",
    categoryColumn: "Type",
    subject: "Subject",
    category: {
      material_fact: "Material fact",
      market_notice: "Market notice",
      shareholder_notice: "Shareholder notice",
      shareholder_meeting: "Shareholder meeting",
    },
    openDocument: (subject: string) => `${subject} (opens the document on the CVM site)`,
    notLoaded: "The CVM filings haven't been loaded yet; they arrive with the nightly update.",
    notACompany:
      "The CVM doesn't link this code to a listed company. ETFs, real-estate funds and BDRs don't file these documents.",
    empty: "No recent filing with the CVM.",
  },
};

const ptBR = {
  reading: {
    title: "Leitura do ativo",
    subtitle: (session: string) =>
      `Calculada pelo motor com o fechamento de ${session}. Frases prontas, sem IA.`,
    noSession: "Ainda não há fechamento deste ativo, então não há o que ler.",
    unavailable: "Não foi possível calcular a leitura. Tente mais tarde.",
    chipsLabel: "Leitura",
    trend: {
      name: "Tendência",
      label: {
        up: "Tendência de alta",
        down: "Tendência de baixa",
        sideways: "Sem tendência clara",
      },
      chip: { up: "alta", down: "baixa", sideways: "lateral" },
      sentence: {
        up: "O preço fechou acima da média dos últimos 50 pregões, e essa média está acima da de 200: é o desenho clássico de uma tendência de alta.",
        down: "O preço fechou abaixo da média dos últimos 50 pregões, e essa média está abaixo da de 200: é o desenho clássico de uma tendência de baixa.",
        sideways:
          "O preço e as médias de 50 e de 200 pregões não apontam para o mesmo lado: o ativo está andando de lado ou mudando de rumo.",
      },
      missing: "A tendência precisa do preço de cada um dos últimos 200 pregões, e falta algum.",
      detail: (smaShort: string, smaLong: string) => `Média 50 ${smaShort} · Média 200 ${smaLong}`,
    },
    momentum: {
      name: "Força (RSI 14)",
      label: { oversold: "Sobrevendido", neutral: "Neutro", overbought: "Sobrecomprado" },
      sentence: {
        oversold: (rsi: string) =>
          `O RSI está em ${rsi}, na faixa de 30 ou menos: as quedas recentes foram fortes, e às vezes vem um respiro depois.`,
        neutral: (rsi: string) =>
          `O RSI está em ${rsi}, entre 30 e 70: nem as compras nem as vendas estão exageradas.`,
        overbought: (rsi: string) =>
          `O RSI está em ${rsi}, na faixa de 70 ou mais: as altas recentes foram fortes, e às vezes vem uma correção depois.`,
      },
      missing: "Ainda faltam pregões para calcular o RSI.",
    },
    range: {
      name: "Oscilação diária (ATR 14)",
      label: { calm: "Calma", normal: "Normal", wide: "Larga" },
      sentence: {
        calm: (atr: string, share: string) =>
          `Em média o ativo anda ${atr} por dia (${share} do preço), até 1,5%: movimentos curtos.`,
        normal: (atr: string, share: string) =>
          `Em média o ativo anda ${atr} por dia (${share} do preço), entre 1,5% e 3,5%.`,
        wide: (atr: string, share: string) =>
          `Em média o ativo anda ${atr} por dia (${share} do preço), 3,5% ou mais: movimentos largos, então estruturas com perda limitada combinam melhor.`,
      },
      missing: "Ainda faltam pregões para calcular o ATR.",
    },
    impliedVolatility: {
      name: "Volatilidade implícita",
      label: { low: "Opções baratas", normal: "Opções no preço usual", high: "Opções caras" },
      chip: { low: "IV baixa", normal: "IV normal", high: "IV alta" },
      sentence: {
        low: (iv: string, rank: string) =>
          `A volatilidade implícita está em ${iv}, com IV rank ${rank}: entre as mais baixas do último ano. As opções estão relativamente baratas, o que favorece comprar opções ou montar travas compradas.`,
        normal: (iv: string, rank: string) =>
          `A volatilidade implícita está em ${iv}, com IV rank ${rank}: dentro da faixa usual do último ano.`,
        high: (iv: string, rank: string) =>
          `A volatilidade implícita está em ${iv}, com IV rank ${rank}: entre as mais altas do último ano. As opções estão relativamente caras, o que favorece vender opções ou montar travas vendidas.`,
      },
      noRank: (iv: string) =>
        `A volatilidade implícita está em ${iv}. Para dizer se isso é alto ou baixo, é preciso um valor em cada um dos últimos 252 pregões, e falta algum.`,
      missing:
        "Ainda não há índice de volatilidade implícita para este ativo: ele depende de opções negociadas.",
    },
    options: {
      name: "Opções",
      label: {
        liquid: "Opções líquidas",
        thin: "Poucas opções negociadas",
        none: "Sem opções negociadas",
      },
      chip: "opções",
      chipTitle: "Opções líquidas",
      sentence: {
        liquid: (count: number, session: string) =>
          `${String(count)} séries de opções tiveram negócios no pregão de ${session}.`,
        thin: (count: number, session: string) =>
          `Só ${String(count)} ${count === 1 ? "série teve" : "séries tiveram"} negócios no pregão de ${session}. Montar uma operação pode ser difícil: confira os negócios de cada série antes.`,
        none: (session: string) =>
          `Nenhuma série de opção deste ativo teve negócios no pregão de ${session}.`,
      },
      notListed: "Este ativo não tem opções listadas na B3.",
      expiriesTitle: "Próximos vencimentos",
      expiry: (date: string, series: number, traded: number) =>
        `${date} · ${String(series)} ${series === 1 ? "série" : "séries"}, ${String(traded)} com negócios`,
    },
  },
  instrument: {
    overline: "Ativo",
    adjusted: "Ajustada",
    nominal: "Nominal",
    volume: "Volume",
    noData: "Ainda não há candle para este ativo.",
    unavailable: "Não foi possível carregar o gráfico. Tente novamente.",
  },
  marketIndex: {
    chipLabel: "Ibovespa",
    chipUnit: "Nível de fechamento, em pontos",
    chipSource: "B3",
    noData: "Ainda não há fechamento do Ibovespa.",
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
    history: {
      title: "Histórico de preço e volatilidade",
      subtitle: (sessions: number) =>
        `Últimos ${String(sessions)} pregões com registro. A volatilidade implícita é calculada pelo motor a partir do fechamento de cada pregão (Black-Scholes).`,
      seriesClose: "Fechamento da série",
      underlyingClose: (underlying: string) => `Fechamento de ${underlying}`,
      impliedVolatility: "Volatilidade implícita",
      noValue: "sem valor",
      volatilityUnavailable:
        "Não há dados suficientes para calcular a volatilidade implícita nestes pregões.",
    },
  },
  exchangeRate: {
    overline: "Câmbio",
    pairLabel: { USDBRL: "Dólar", EURBRL: "Euro" },
    chipPtax: "PTAX de venda",
    chipSource: "Banco Central (Bacen)",
    note: "A PTAX é a taxa de referência do Banco Central, divulgada por volta das 13h no calendário de dias úteis do próprio Bacen; não é um fechamento de mercado.",
    lastRate: (date: string) => `Última PTAX, ${date}`,
    noData: "Ainda não há cotação PTAX para este par.",
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
  companyFilings: {
    title: "Eventos recentes",
    subtitle:
      "Fatos relevantes, comunicados, avisos aos acionistas e assembleias entregues à CVM. Fonte: dados abertos da CVM (ODbL).",
    deliveredUntilToday: "Dados da CVM até hoje.",
    deliveredUntilYesterday: "Dados da CVM até ontem.",
    deliveredUntil: (date: string) => `Dados da CVM até ${date}.`,
    deliveredOn: "Entrega",
    categoryColumn: "Tipo",
    subject: "Assunto",
    category: {
      material_fact: "Fato relevante",
      market_notice: "Comunicado ao mercado",
      shareholder_notice: "Aviso aos acionistas",
      shareholder_meeting: "Assembleia",
    },
    openDocument: (subject: string) => `${subject} (abre o documento no site da CVM)`,
    notLoaded:
      "Os documentos da CVM ainda não foram carregados; eles chegam na atualização noturna.",
    notACompany:
      "A CVM não associa este código a uma companhia aberta. ETFs, fundos imobiliários e BDRs não entregam esses documentos.",
    empty: "Nenhum documento recente entregue à CVM.",
  },
} satisfies typeof en;

export const marketDataStrings = { en, ptBR } as const;

export const t = marketDataStrings.ptBR;
