const en = {
  form: {
    overline: "Risk profile",
    title: "Declared capital and limits",
    subtitle: "Fetha never reads your balance from a bank or broker; you declare it here.",
    declaredCapital: "Declared capital",
    maxLossPerOperation: "Max loss per operation",
    maxExposurePerOperation: "Max exposure per operation",
    maxOpenOperations: "Max open operations",
    maxPremiumBought: "Max option premium bought",
    asPercentOfCapital: "% of declared capital",
    submit: "Save risk profile",
    saved: "Risk profile saved.",
    errors: {
      invalid: "Check the values: capital must be positive and limits between 0 and 100%.",
    },
  },
  chip: { noRiskProfile: "no risk profile" },
};

const ptBR = {
  form: {
    overline: "Perfil de risco",
    title: "Capital declarado e limites",
    subtitle: "A Fetha nunca lê seu saldo de um banco ou corretora; você declara aqui.",
    declaredCapital: "Capital declarado",
    maxLossPerOperation: "Perda máxima por operação",
    maxExposurePerOperation: "Exposição máxima por operação",
    maxOpenOperations: "Máximo de operações abertas",
    maxPremiumBought: "Prêmio máximo comprado em opções",
    asPercentOfCapital: "% do capital declarado",
    submit: "Salvar perfil de risco",
    saved: "Perfil de risco salvo.",
    errors: {
      invalid: "Confira os valores: o capital deve ser positivo e os limites entre 0 e 100%.",
    },
  },
  chip: { noRiskProfile: "sem perfil de risco" },
} satisfies typeof en;

export const riskProfileStrings = { en, ptBR } as const;

export const t = riskProfileStrings.ptBR;
