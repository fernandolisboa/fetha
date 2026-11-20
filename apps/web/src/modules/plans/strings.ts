const en = {
  summary: {
    fromView: {
      up: "Fetha built this {structure} on {ticker} because you expect it to rise and volatility is {ivRegime}.",
      down: "Fetha built this {structure} on {ticker} because you expect it to fall and volatility is {ivRegime}.",
      sideways:
        "Fetha built this {structure} on {ticker} because you expect it to move sideways and volatility is {ivRegime}.",
      unsure:
        "Fetha built this {structure} on {ticker} to fit the current, {ivRegime} volatility, since you have no view on direction.",
    },
    fromSuggestion: "Fetha built this {structure} on {ticker} from today's suggestion.",
  },
  doesNotFit:
    "Even one lot of this {structure} loses more than your risk limit allows per operation; Fetha could not fit it.",
  ivRegimes: { low: "low", high: "high", any: "any" },
} satisfies Record<string, unknown>;

const ptBR = {
  summary: {
    fromView: {
      up: "A Fetha montou essa {structure} em {ticker} porque você espera alta e a volatilidade está {ivRegime}.",
      down: "A Fetha montou essa {structure} em {ticker} porque você espera queda e a volatilidade está {ivRegime}.",
      sideways:
        "A Fetha montou essa {structure} em {ticker} porque você espera lateralização e a volatilidade está {ivRegime}.",
      unsure:
        "A Fetha montou essa {structure} em {ticker} para a volatilidade atual, {ivRegime}, já que você não tem uma visão de direção.",
    },
    fromSuggestion: "A Fetha montou essa {structure} em {ticker} a partir da sugestão de hoje.",
  },
  doesNotFit:
    "Mesmo um lote dessa {structure} perde mais do que o seu limite de risco permite por operação; a Fetha não conseguiu encaixar o plano.",
  ivRegimes: { low: "baixa", high: "alta", any: "qualquer" },
} satisfies typeof en;

export const plansStrings = { en, ptBR } as const;

export const t = plansStrings.ptBR;
