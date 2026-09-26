const en = {
  dataExport: {
    title: "Your data",
    subtitle:
      "Download everything Fetha keeps about you in one JSON file: account, preferences, watchlist, strategies, signals, portfolio, backtests, decisions and scores, and the access log.",
    action: "Export my data",
    rateLimited: "Too many exports in a row. Wait a minute and try again.",
  },
};

const ptBR = {
  dataExport: {
    title: "Seus dados",
    subtitle:
      "Baixe tudo o que o Fetha guarda sobre você em um único arquivo JSON: conta, preferências, watchlist, estratégias, sinais, carteira, backtests, decisões e pontuações, além do registro de acesso.",
    action: "Exportar meus dados",
    rateLimited: "Muitas exportações seguidas. Aguarde um minuto e tente de novo.",
  },
} satisfies typeof en;

export const accountStrings = { en, ptBR } as const;

export const t = accountStrings.ptBR;
