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
        description: "Green phosphor of an old monitor, all monospaced. From Bardo and Mascate.",
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
      "Where the navigation and the market bar sit. Every screen does the same things in every layout.",
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
      dock: {
        label: "Dock",
        description:
          "Floating menu over the page's left edge: icons at rest, names when you hover it. No column of its own, so the page gets almost all the width.",
      },
    },
  },
  suggestionArchive: {
    title: "Seen suggestions",
    subtitle:
      "Take a suggestion off Today's suggestions some time after you first see it. While this is on, Fetha records when each suggestion first shows on your screen; while it is off, nothing is recorded, and turning it off erases what was recorded. An archived suggestion keeps its own page, and you can still decide on it while it is open.",
    toggle: "Archive the suggestions I have already seen",
    delayLabel: "Take a suggestion off the panel after",
    amountLabel: "How many",
    unitLabel: "Unit",
    units: { minutes: "minutes", hours: "hours", days: "days", weeks: "weeks" },
    unitsOne: { minutes: "minute", hours: "hour", days: "day", weeks: "week" },
    duration: {
      minutes: (amount: string, one: boolean) => `${amount} ${one ? "minute" : "minutes"}`,
      hours: (amount: string, one: boolean) => `${amount} ${one ? "hour" : "hours"}`,
      days: (amount: string, one: boolean) => `${amount} ${one ? "day" : "days"}`,
      weeks: (amount: string, one: boolean) => `${amount} ${one ? "week" : "weeks"}`,
    },
    presetsLabel: "Shortcuts",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    invalidAmount: "Use a whole number, 1 or more.",
    tooLong: "The longest is 1 year.",
    example: (seenAt: string, day: string, time: string) =>
      `Seen now, at ${seenAt}, a suggestion leaves the panel on ${day} at ${time}.`,
    off: "Off: every open suggestion stays on the panel, and nothing about what you see is recorded.",
    failed: "Could not save. Try again.",
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
        description:
          "Verde fósforo de monitor antigo, tudo em monoespaçada. Vem do Bardo e do Mascate.",
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
      "Onde ficam a navegação e a barra de mercado. Toda tela faz as mesmas coisas em qualquer layout.",
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
      dock: {
        label: "Dock",
        description:
          "Menu flutuante sobre a borda esquerda: só ícones e, ao passar o mouse, os nomes. Não ocupa coluna própria, então a tela fica com quase toda a largura.",
      },
    },
  },
  suggestionArchive: {
    title: "Sugestões já vistas",
    subtitle:
      "Tira uma sugestão de Sugestões de hoje algum tempo depois que você a viu pela primeira vez. Com a opção ligada, o Fetha guarda quando cada sugestão apareceu na sua tela pela primeira vez; desligada, nada é guardado, e desligar apaga o que já tinha sido guardado. A sugestão arquivada continua com a página dela, e você ainda pode decidir sobre ela enquanto estiver aberta.",
    toggle: "Arquivar as sugestões que eu já vi",
    delayLabel: "Tirar a sugestão do quadro depois de",
    amountLabel: "Quantos",
    unitLabel: "Unidade",
    units: { minutes: "minutos", hours: "horas", days: "dias", weeks: "semanas" },
    unitsOne: { minutes: "minuto", hours: "hora", days: "dia", weeks: "semana" },
    duration: {
      minutes: (amount: string, one: boolean) => `${amount} ${one ? "minuto" : "minutos"}`,
      hours: (amount: string, one: boolean) => `${amount} ${one ? "hora" : "horas"}`,
      days: (amount: string, one: boolean) => `${amount} ${one ? "dia" : "dias"}`,
      weeks: (amount: string, one: boolean) => `${amount} ${one ? "semana" : "semanas"}`,
    },
    presetsLabel: "Atalhos",
    save: "Salvar",
    saving: "Salvando…",
    saved: "Salvo.",
    invalidAmount: "Use um número inteiro, de 1 para cima.",
    tooLong: "O máximo é 1 ano.",
    example: (seenAt: string, day: string, time: string) =>
      `Vista agora, às ${seenAt}, uma sugestão sai do quadro em ${day}, às ${time}.`,
    off: "Desligado: toda sugestão aberta continua no quadro, e nada do que você vê é guardado.",
    failed: "Não deu para salvar. Tente de novo.",
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
