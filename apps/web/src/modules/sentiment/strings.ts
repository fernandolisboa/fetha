const en = {
  panel: {
    title: "Sentiment",
    subtitle: "Experimental. Updated every night for the assets on a watchlist.",
    notWatched:
      "Sentiment is gathered every night for the assets on a watchlist. Add this asset to yours to follow it.",
  },
  filings: {
    title: "CVM filings, last 90 days",
    explainer:
      "An AI (Claude Haiku) reads each material fact, notice and meeting document and labels its subject and what it means for shareholders. It writes no numbers and can be wrong: open the document before acting on it.",
    off: "AI labels are off for now; the filings themselves are listed under Recent events.",
    notACompany:
      "This code isn't a listed company (ETFs, real-estate funds and BDRs don't file with the CVM), so there are no filings to read.",
    none: "No filing labelled in the last 90 days.",
    waiting: (count: number) =>
      count === 1
        ? "1 filing is waiting to be read tonight."
        : `${String(count)} filings are waiting to be read tonight.`,
    unlabelled: (count: number) =>
      count === 1
        ? "1 filing couldn't be labelled (unreadable file or discarded answer) and isn't counted above."
        : `${String(count)} filings couldn't be labelled (unreadable file or discarded answer) and aren't counted above.`,
    count: {
      positive: (count: number): string => (count === 1 ? "positive filing" : "positive filings"),
      neutral: (count: number): string => (count === 1 ? "neutral filing" : "neutral filings"),
      negative: (count: number): string => (count === 1 ? "negative filing" : "negative filings"),
    },
    countsLabel: "Filings by tone",
    tone: { positive: "positive", neutral: "neutral", negative: "negative" },
    topic: {
      results: "Results",
      dividends: "Dividends",
      guidance: "Guidance",
      m_and_a: "M&A",
      debt: "Debt",
      litigation: "Litigation",
      management: "Management",
      buyback: "Buyback",
      offering: "Offering",
      other: "Other",
    },
    openDocument: (topic: string) => `Open the ${topic} filing on the CVM site`,
  },
  news: {
    title: "News tone",
    explainer:
      "Average tone of Portuguese-language news GDELT finds for the company, day by day. Above zero leans positive, below leans negative. The search is by name and tickers, so unrelated news can slip in.",
    average: (tone: string, articles: number) =>
      `Last 30 days: average tone ${tone} across ${String(articles)} ${articles === 1 ? "article" : "articles"}.`,
    noArticles: "GDELT returned no article about the company for the last 30 days.",
    notYet: "The news tone hasn't been fetched yet; it arrives with a nightly update.",
    rateLimited:
      "GDELT asked us to slow down on the last attempt; the next nightly update tries again.",
    failed: "The last GDELT query failed; the next nightly update tries again.",
    query: (query: string) => `Search: ${query}`,
    fetchedOn: (date: string) => `Last fetched on ${date}.`,
    attribution: "Source: The GDELT Project. Tone computed by GDELT.",
    chartLabel: "Daily news tone over the last 90 days",
  },
  provider: {
    title: "News with sentiment",
    attribution: "Source: Marketaux. Score from −1 to 1 computed by Marketaux for this ticker.",
    none: "No recent article for this ticker.",
    sentiment: { positive: "positive", neutral: "neutral", negative: "negative" },
    openArticle: (title: string) => `${title} (opens the article on the source's site)`,
  },
};

const ptBR = {
  panel: {
    title: "Sentimento",
    subtitle: "Experimental. Atualizado toda noite para os ativos que estão em alguma watchlist.",
    notWatched:
      "O sentimento é coletado toda noite para os ativos que estão em alguma watchlist. Adicione este ativo à sua para acompanhar.",
  },
  filings: {
    title: "Documentos da CVM, últimos 90 dias",
    explainer:
      "Uma IA (Claude Haiku) lê cada fato relevante, comunicado e documento de assembleia e indica o assunto e o que ele significa para o acionista. Ela não escreve números e pode errar: abra o documento antes de agir.",
    off: "Os rótulos de IA estão desligados por enquanto; os documentos em si aparecem em Eventos recentes.",
    notACompany:
      "Este código não é de uma companhia aberta (ETFs, fundos imobiliários e BDRs não entregam documentos à CVM), então não há documentos para ler.",
    none: "Nenhum documento rotulado nos últimos 90 dias.",
    waiting: (count: number) =>
      count === 1
        ? "1 documento aguarda leitura na próxima atualização noturna."
        : `${String(count)} documentos aguardam leitura na próxima atualização noturna.`,
    unlabelled: (count: number) =>
      count === 1
        ? "1 documento não pôde ser rotulado (arquivo ilegível ou resposta descartada) e não entra na contagem acima."
        : `${String(count)} documentos não puderam ser rotulados (arquivo ilegível ou resposta descartada) e não entram na contagem acima.`,
    count: {
      positive: (count: number): string => (count === 1 ? "positivo" : "positivos"),
      neutral: (count: number): string => (count === 1 ? "neutro" : "neutros"),
      negative: (count: number): string => (count === 1 ? "negativo" : "negativos"),
    },
    countsLabel: "Documentos por tom",
    tone: { positive: "positivo", neutral: "neutro", negative: "negativo" },
    topic: {
      results: "Resultados",
      dividends: "Proventos",
      guidance: "Projeções",
      m_and_a: "Fusões e aquisições",
      debt: "Dívida",
      litigation: "Processos",
      management: "Gestão",
      buyback: "Recompra",
      offering: "Oferta de ações",
      other: "Outros",
    },
    openDocument: (topic: string) => `Abrir o documento de ${topic} no site da CVM`,
  },
  news: {
    title: "Tom das notícias",
    explainer:
      "Tom médio das notícias em português que a GDELT encontra sobre a empresa, dia a dia. Acima de zero puxa para o positivo; abaixo, para o negativo. A busca é pelo nome e pelos códigos, então podem entrar notícias que não têm a ver com a empresa.",
    average: (tone: string, articles: number) =>
      `Últimos 30 dias: tom médio ${tone} em ${String(articles)} ${articles === 1 ? "notícia" : "notícias"}.`,
    noArticles: "A GDELT não devolveu notícias sobre a empresa nos últimos 30 dias.",
    notYet: "O tom das notícias ainda não foi buscado; ele chega com uma atualização noturna.",
    rateLimited:
      "Na última tentativa, a GDELT pediu para diminuir o ritmo; a próxima atualização noturna tenta de novo.",
    failed: "A última busca na GDELT falhou; a próxima atualização noturna tenta de novo.",
    query: (query: string) => `Busca: ${query}`,
    fetchedOn: (date: string) => `Última coleta em ${date}.`,
    attribution: "Fonte: The GDELT Project. Tom calculado pela GDELT.",
    chartLabel: "Tom diário das notícias nos últimos 90 dias",
  },
  provider: {
    title: "Notícias com sentimento",
    attribution: "Fonte: Marketaux. Nota de −1 a 1 calculada pela Marketaux para este código.",
    none: "Nenhuma notícia recente sobre este código.",
    sentiment: { positive: "positiva", neutral: "neutra", negative: "negativa" },
    openArticle: (title: string) => `${title} (abre a notícia no site de origem)`,
  },
} satisfies typeof en;

export const sentimentStrings = { en, ptBR } as const;

export const t = sentimentStrings.ptBR;
