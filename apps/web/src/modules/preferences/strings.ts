const en = {
  themePicker: {
    title: "Theme",
    subtitle: "Pick the token set for the whole workstation.",
    options: {
      instrumento: {
        label: "Instrumento",
        description: "Dense, cyan accent, monospaced numbers.",
      },
      terminal: {
        label: "Terminal",
        description: "All monospaced, near-black, amber accent.",
      },
      amplo: {
        label: "Amplo",
        description: "Serif headlines, more air, warm palette.",
      },
    },
  },
  settings: {
    title: "Settings",
    overline: "Account",
    tabsLabel: "Settings sections",
    tabs: {
      aparencia: "Appearance",
      risco: "Risk",
      ia: "AI",
      conta: "Account",
      administracao: "Administration",
    },
  },
};

const ptBR = {
  themePicker: {
    title: "Tema",
    subtitle: "Escolha o conjunto de cores e tipografia da estação inteira.",
    options: {
      instrumento: {
        label: "Instrumento",
        description: "Denso, acento ciano, números em monoespaçada.",
      },
      terminal: {
        label: "Terminal",
        description: "Tudo em monoespaçada, quase preto, acento âmbar.",
      },
      amplo: {
        label: "Amplo",
        description: "Títulos serifados, mais respiro, paleta quente.",
      },
    },
  },
  settings: {
    title: "Configurações",
    overline: "Conta",
    tabsLabel: "Seções das configurações",
    tabs: {
      aparencia: "Aparência",
      risco: "Risco",
      ia: "IA",
      conta: "Conta",
      administracao: "Administração",
    },
  },
} satisfies typeof en;

export const preferencesStrings = { en, ptBR } as const;

export const t = preferencesStrings.ptBR;
