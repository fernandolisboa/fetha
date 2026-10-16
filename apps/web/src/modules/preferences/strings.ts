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
      grafite: {
        label: "Grafite",
        description: "Dark graphite, amber accent, Windows font. From Bardo and Mascate.",
      },
      "ouro-negro": {
        label: "Ouro Negro",
        description: "Black and gold, all monospaced, square corners. From Bardo and Mascate.",
      },
      fosforo: {
        label: "Fósforo",
        description: "Green phosphor terminal, all monospaced. From Bardo and Mascate.",
      },
      papel: {
        label: "Papel",
        description:
          "The light theme: paper-colored ground, dark amber accent. From Bardo and Mascate.",
      },
    },
    modes: {
      dark: "Dark",
      light: "Light",
    },
  },
  layoutPicker: {
    title: "Layout",
    subtitle:
      "Where the navigation and the market bar sit. Every screen does the same things in both layouts.",
    options: {
      workspace: {
        label: "Workspace",
        description: "Side rail with the six destinations, market bar in the header.",
      },
      studio: {
        label: "Studio",
        description:
          "Denser: destinations as tabs in the header, compact page titles, market bar in a status bar at the bottom.",
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
      grafite: {
        label: "Grafite",
        description: "Grafite escuro, acento âmbar, fonte do Windows. Vem do Bardo e do Mascate.",
      },
      "ouro-negro": {
        label: "Ouro Negro",
        description:
          "Preto e dourado, tudo em monoespaçada, cantos retos. Vem do Bardo e do Mascate.",
      },
      fosforo: {
        label: "Fósforo",
        description: "Terminal de fósforo verde, tudo em monoespaçada. Vem do Bardo e do Mascate.",
      },
      papel: {
        label: "Papel",
        description:
          "O tema claro: fundo cor de papel e acento âmbar escuro. Vem do Bardo e do Mascate.",
      },
    },
    modes: {
      dark: "Escuro",
      light: "Claro",
    },
  },
  layoutPicker: {
    title: "Layout",
    subtitle:
      "Onde ficam a navegação e a barra de mercado. Toda tela faz as mesmas coisas nos dois layouts.",
    options: {
      workspace: {
        label: "Workspace",
        description: "Barra lateral com os seis destinos, barra de mercado no cabeçalho.",
      },
      studio: {
        label: "Studio",
        description:
          "Mais denso: destinos em abas no cabeçalho, títulos compactos e a barra de mercado numa barra de status embaixo.",
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
