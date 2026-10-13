import type { DestinationHref } from "@/modules/shell/client";

interface DestinationGuide {
  summary: string;
  steps: string[];
}

const en = {
  tour: {
    replay: "Replay the tour",
    progress: (step: number, total: number) => `Step ${String(step)} of ${String(total)}`,
    skip: "Skip tour",
    back: "Back",
    next: "Next",
    finish: "Finish",
    steps: {
      welcome: {
        title: "Welcome to Fetha",
        body: "A quick tour of the workstation: where each thing lives and where to start. Skip it whenever you like; the Como usar guide stays in the account menu.",
      },
      rail: {
        title: "Navigation",
        body: "Fetha's six destinations live here. On a computer, the button at the end of the side bar collapses it to give the content more room.",
      },
      commandSearch: {
        title: "Search",
        body: "Press Ctrl K anywhere to search an instrument, an option series or a strategy and jump straight to its page.",
      },
      addInstrument: {
        title: "Start with the watchlist",
        body: "Click “Adicionar ativo” and search a ticker, such as PETR4. Active strategies are evaluated on the watchlist's instruments.",
      },
      strategies: {
        title: "Strategies",
        body: "Create a strategy from the catalog, run a backtest and mark it “Ativa” to have it evaluated every night.",
      },
      signals: {
        title: "Signals",
        body: "What your active strategies propose lands here after the close. Answer each signal with a decision.",
      },
      portfolio: {
        title: "Portfolio",
        body: "Your real positions, entered by hand or imported from the B3 spreadsheet. Fetha places no orders.",
      },
      journal: {
        title: "Journal",
        body: "Every decision is recorded and scored when its horizon arrives, so you see how your calls aged.",
      },
      accountMenu: {
        title: "Account menu",
        body: "The Como usar guide, settings and sign out live here. You can replay this tour from the guide.",
      },
    },
  },
  assetTour: {
    steps: {
      assetReading: {
        title: "The asset's reading",
        body: "These chips summarize trend, momentum, swing size and implied volatility, recomputed every night from B3 data. They are here whether or not you have a strategy for this asset.",
      },
      assetNextSteps: {
        title: "Next steps",
        body: "Keep following the asset, study an operation in the builder, or wait for a ready-made recipe. A strategy is optional: it only adds the nightly evaluation that can raise a signal in Sinais.",
      },
      assetChart: {
        title: "The candle chart",
        body: "Toggle between adjusted (splits and dividends folded in) and nominal (the price as traded) whenever the comparison matters.",
      },
    },
  },
  optionsBasics: {
    title: "Options in 10 minutes",
    intro:
      "An option is a contract on an underlying stock. A call gives the right to buy it at a fixed price; a put gives the right to sell it at a fixed price. You pay a premium for that right, and the most you can ever lose by buying an option is the premium itself.",
    illustrativeNotice: (ticker: string, spot: string) =>
      `Illustrative example: a fictitious underlying, ${ticker}, trading at ${spot}, and a fictitious option chain with made-up prices. Every number below still comes from the pricing engine, not from the page.`,
    strike: {
      title: "Strike (the exercise price)",
      body: "The price fixed in the contract: the price a call lets you buy at, or a put lets you sell at. A call is worth exercising when the stock trades above its strike; a put, when it trades below.",
    },
    expiry: {
      title: "Expiry",
      body: "The day the contract stops existing. On B3, equity options expire monthly, usually on the third Friday of the month (moved to the prior business day on a holiday).",
    },
    premium: {
      title: "Premium",
      body: "What the option costs, paid by the buyer to the seller when the position opens. It is what a long position can lose in full, and what a short, uncovered position earns at most.",
    },
    impliedVolatility: {
      title: "Implied volatility",
      body: "The swing size the market is pricing into the option today, read backwards out of its premium: a higher implied volatility makes every option on that stock costlier, calls and puts alike, because a wider expected swing raises the odds of a large move either way.",
      ivRank:
        "IV rank, shown on the asset page, says where today's implied volatility sits against its own last year: low favors buying options, high favors selling them.",
    },
    structures: {
      longCall: {
        title: "Long call",
        body: "Buy one call. The most you can lose is the premium paid, however far the stock falls; the gain grows without limit as the stock rises past the strike.",
      },
      longPut: {
        title: "Long put",
        body: "Buy one put. The most you can lose is the premium paid; the gain grows as the stock falls, capped only because a stock price cannot go below zero.",
      },
      bullCallSpread: {
        title: "Bull call spread (trava de alta com calls)",
        body: "Buy a call at the lower strike and sell a call at the higher strike, same expiry. The premium received from the short call lowers the cost of the long one, at the price of a capped gain: both the loss and the gain are bounded.",
      },
    },
  },
  guide: {
    title: "How to use Fetha",
    documentTitle: "How to use",
    overline: "Help",
    intro:
      "Fetha is a lab for studying B3 instruments before risking money. It prices, backtests and evaluates your strategies on public daily data, and keeps a journal of your decisions scored against what actually happened.",
    open: (destination: string) => `Open ${destination}`,
    flow: {
      title: "The usual path",
      steps: [
        "Declare your capital and risk limits in Configurações.",
        "Add the instruments you follow to the Watchlist.",
        "Create a strategy and run a backtest on it.",
        "Mark the strategy active: it is evaluated every night after the close.",
        "Answer each signal in Sinais with a decision.",
        "Follow the Diário: each decision is scored when its horizon arrives.",
      ],
    },
    header: {
      title: "Top of the screen",
      steps: [
        "Press Ctrl K to search an instrument, an option series or a strategy and jump straight to its page.",
        "On an instrument's page, the market bar shows its last close and how recent it is, such as “fechamento de ontem”.",
        "The account menu holds this guide, settings and sign out.",
      ],
    },
    principles: {
      title: "What Fetha does not do",
      steps: [
        "It places no orders and connects to no broker or bank.",
        "Every number comes from the engine, from public B3 and Bacen data refreshed every night.",
        "Every decision is yours.",
      ],
    },
    destinations: {
      "/": {
        summary: "The instruments you follow. Active strategies are evaluated on them every night.",
        steps: [
          "Click “Adicionar ativo” and search by ticker, such as PETR4.",
          "Click a ticker to open its candle chart.",
          "Remove an instrument from its own row when you stop following it.",
        ],
      },
      "/sinais": {
        summary: "The inbox of entries, exits and adjustments your active strategies raised.",
        steps: [
          "Answer each signal with “Registrar decisão”: choose the kind, your rationale and the horizon.",
          "Answering a signal marks it read and lowers the count next to Sinais in the navigation.",
          "“Não entrar” is a decision too, and it is scored as well.",
          "The evaluation log lists every evaluation, including those that raised nothing.",
        ],
      },
      "/estrategias": {
        summary:
          "Your strategies as data: entry conditions, strikes, expiry window, sizing and exits.",
        steps: [
          "“Nova estratégia” starts from a structure in the catalog.",
          "Every save creates a new version; open a strategy to run a backtest on your watchlist.",
          "Mark it “Ativa” to have it evaluated every night.",
          "“Comparar backtests” puts up to three runs side by side.",
          "Share a strategy read-only with other users, copy one they shared, and archive what you no longer use.",
          "A strategy is optional: without one marked active, an asset's page still shows its reading; an active strategy only adds the nightly evaluation that can raise a signal in Sinais.",
        ],
      },
      "/carteira": {
        summary: "Your real positions, entered by you and marked to market at the latest close.",
        steps: [
          "“Registrar execução” records a fill by hand; “Importar planilha da B3” reads the trading export from the B3 investor area.",
          "Group fills into operations to follow each one's result.",
          "“Nova operação” opens the builder: assemble a structure leg by leg and see payoff, greeks, break-evens and max loss.",
          "Expired series wait for your confirmation before anything is settled.",
        ],
      },
      "/diario": {
        summary: "Every decision you recorded, scored when its horizon arrives.",
        steps: [
          "Each entry shows the decision, your rationale, the horizon and, once it passes, the score.",
          "The track record panel shows how your decisions have aged.",
        ],
      },
      "/configuracoes": {
        summary: "Your account and how the workstation looks.",
        steps: [
          "Declare capital and risk limits; without them pricing shows the “sem perfil de risco” chip.",
          "Pick a theme: Instrumento, Terminal or Amplo.",
          "Export your data, review the access log or delete your account.",
        ],
      },
    } satisfies Record<DestinationHref, DestinationGuide>,
  },
};

const ptBR = {
  tour: {
    replay: "Refazer o tour",
    progress: (step: number, total: number) => `Passo ${String(step)} de ${String(total)}`,
    skip: "Pular tour",
    back: "Voltar",
    next: "Próximo",
    finish: "Concluir",
    steps: {
      welcome: {
        title: "Boas-vindas à Fetha",
        body: "Um tour rápido pela estação: onde fica cada coisa e por onde começar. Pule quando quiser; o guia Como usar continua no menu da conta.",
      },
      rail: {
        title: "Navegação",
        body: "Os seis destinos da Fetha ficam aqui. No computador, o botão no fim da barra lateral a recolhe para dar mais espaço ao conteúdo.",
      },
      commandSearch: {
        title: "Busca",
        body: "Aperte Ctrl K em qualquer tela para buscar um ativo, uma série de opção ou uma estratégia e ir direto para a página.",
      },
      addInstrument: {
        title: "Comece pela watchlist",
        body: "Clique em “Adicionar ativo” e busque um código, como PETR4. As estratégias ativas são avaliadas nos ativos da watchlist.",
      },
      strategies: {
        title: "Estratégias",
        body: "Crie uma estratégia a partir do catálogo, rode um backtest e marque como “Ativa” para ela ser avaliada toda noite.",
      },
      signals: {
        title: "Sinais",
        body: "O que suas estratégias ativas propõem chega aqui depois do fechamento. Responda cada sinal com uma decisão.",
      },
      portfolio: {
        title: "Carteira",
        body: "Suas posições reais, lançadas à mão ou importadas da planilha da B3. A Fetha não envia ordens.",
      },
      journal: {
        title: "Diário",
        body: "Cada decisão fica registrada e é pontuada quando chega o horizonte, para você ver como suas escolhas envelheceram.",
      },
      accountMenu: {
        title: "Menu da conta",
        body: "O guia Como usar, as configurações e o botão de sair ficam aqui. Pelo guia, dá para refazer este tour.",
      },
    },
  },
  assetTour: {
    steps: {
      assetReading: {
        title: "A leitura do ativo",
        body: "Essas etiquetas resumem tendência, força do movimento, tamanho das oscilações e volatilidade implícita, recalculadas toda noite com dados da B3. Elas aparecem aqui mesmo sem nenhuma estratégia para este ativo.",
      },
      assetNextSteps: {
        title: "Próximos passos",
        body: "Continue acompanhando o ativo, estude uma operação no montador, ou espere por uma receita pronta. Uma estratégia é opcional: ela só soma a avaliação noturna, que pode gerar um sinal em Sinais.",
      },
      assetChart: {
        title: "O gráfico de candles",
        body: "Alterne entre ajustada (com splits e dividendos já descontados) e nominal (o preço como foi negociado) sempre que a comparação importar.",
      },
    },
  },
  optionsBasics: {
    title: "Opções em 10 minutos",
    intro:
      "Uma opção é um contrato sobre uma ação. A call dá o direito de comprá-la por um preço combinado; a put dá o direito de vendê-la por um preço combinado. Você paga um prêmio por esse direito, e o máximo que se perde comprando uma opção é esse prêmio.",
    illustrativeNotice: (ticker: string, spot: string) =>
      `Exemplo ilustrativo: um ativo fictício, ${ticker}, cotado a ${spot}, e uma série de opções fictícia com preços inventados. Mesmo assim, todo número abaixo vem do motor de cálculo, nunca da própria página.`,
    strike: {
      title: "Strike (preço de exercício)",
      body: "O preço travado no contrato: é por ele que a call deixa comprar, ou a put deixa vender. Vale a pena exercer a call quando a ação está acima do strike; a put, quando está abaixo.",
    },
    expiry: {
      title: "Vencimento",
      body: "O dia em que o contrato deixa de existir. Na B3, as opções sobre ações vencem uma vez por mês, geralmente na terceira sexta-feira (ou no pregão útil anterior, se cair em feriado).",
    },
    premium: {
      title: "Prêmio",
      body: "O preço da opção, pago por quem compra a quem vende, no momento em que a posição é aberta. É o máximo que uma posição comprada perde, e o máximo que uma posição vendida a descoberto ganha.",
    },
    impliedVolatility: {
      title: "Volatilidade implícita",
      body: "O tamanho de oscilação que o mercado está precificando hoje, lido de trás para frente a partir do prêmio: quanto maior a volatilidade implícita, mais caras ficam as opções daquela ação, calls e puts, porque uma oscilação esperada maior aumenta a chance de um movimento grande para qualquer lado.",
      ivRank:
        "O IV rank, mostrado na página do ativo, diz onde a volatilidade implícita de hoje está em relação ao último ano: baixo favorece comprar opções, alto favorece vendê-las.",
    },
    structures: {
      longCall: {
        title: "Compra de call",
        body: "Compre uma call. O máximo que se perde é o prêmio pago, não importa o quanto a ação caia; o ganho cresce sem limite conforme a ação sobe acima do strike.",
      },
      longPut: {
        title: "Compra de put",
        body: "Compre uma put. O máximo que se perde é o prêmio pago; o ganho cresce conforme a ação cai, limitado só porque o preço de uma ação não vai abaixo de zero.",
      },
      bullCallSpread: {
        title: "Trava de alta com calls",
        body: "Compre uma call no strike mais baixo e venda uma call no strike mais alto, no mesmo vencimento. O prêmio recebido pela call vendida reduz o custo da comprada, ao preço de um ganho limitado: tanto a perda quanto o ganho ficam travados.",
      },
    },
  },
  guide: {
    title: "Como usar a Fetha",
    documentTitle: "Como usar",
    overline: "Ajuda",
    intro:
      "A Fetha é um laboratório para estudar ativos da B3 antes de arriscar dinheiro. Ela precifica, faz backtests e avalia suas estratégias com dados diários públicos, e guarda um diário das suas decisões, pontuadas contra o que de fato aconteceu.",
    open: (destination: string) => `Abrir ${destination}`,
    flow: {
      title: "O caminho de sempre",
      steps: [
        "Declare seu capital e seus limites de risco em Configurações.",
        "Adicione à Watchlist os ativos que você acompanha.",
        "Crie uma estratégia e rode um backtest dela.",
        "Marque a estratégia como ativa: ela é avaliada toda noite, depois do fechamento.",
        "Responda cada sinal em Sinais com uma decisão.",
        "Acompanhe o Diário: cada decisão é pontuada quando chega o horizonte dela.",
      ],
    },
    header: {
      title: "No topo da tela",
      steps: [
        "Aperte Ctrl K para buscar um ativo, uma série de opção ou uma estratégia e ir direto para a página.",
        "Na página de um ativo, a barra de mercado mostra o último fechamento e de quando ele é, como “fechamento de ontem”.",
        "O menu da conta tem este guia, as configurações e o botão de sair.",
      ],
    },
    principles: {
      title: "O que a Fetha não faz",
      steps: [
        "Não envia ordens nem se conecta a corretora ou banco.",
        "Todo número vem do motor de cálculo, com dados públicos da B3 e do Bacen atualizados toda noite.",
        "Toda decisão é sua.",
      ],
    },
    destinations: {
      "/": {
        summary:
          "Os ativos que você acompanha. As estratégias ativas são avaliadas neles toda noite.",
        steps: [
          "Clique em “Adicionar ativo” e busque pelo código, como PETR4.",
          "Clique em um código para abrir o gráfico de candles.",
          "Quando deixar de acompanhar um ativo, remova-o na própria linha.",
        ],
      },
      "/sinais": {
        summary:
          "A caixa de entrada das entradas, saídas e ajustes que suas estratégias ativas propuseram.",
        steps: [
          "Responda cada sinal em “Registrar decisão”: escolha o tipo, escreva sua justificativa e defina o horizonte.",
          "Responder um sinal o marca como lido e diminui o contador ao lado de Sinais na navegação.",
          "“Não entrar” também é uma decisão, e também é pontuada.",
          "O log de avaliações lista todas as avaliações, inclusive as que não geraram sinal.",
        ],
      },
      "/estrategias": {
        summary:
          "Suas estratégias como dados: condições de entrada, strikes, janela de vencimento, dimensionamento e saídas.",
        steps: [
          "“Nova estratégia” parte de uma estrutura do catálogo.",
          "Cada vez que você salva, nasce uma nova versão; abra a estratégia para rodar um backtest na sua watchlist.",
          "Marque como “Ativa” para ela ser avaliada toda noite.",
          "“Comparar backtests” coloca até três simulações lado a lado.",
          "Compartilhe uma estratégia em somente leitura, copie as que outros compartilharam e arquive as que não usa mais.",
          "Ter uma estratégia é opcional: mesmo sem nenhuma ativa, a página do ativo já mostra sua leitura; uma estratégia ativa só soma a avaliação noturna, que pode gerar um sinal em Sinais.",
        ],
      },
      "/carteira": {
        summary:
          "Suas posições reais, lançadas por você e marcadas a mercado pelo último fechamento.",
        steps: [
          "“Registrar execução” lança uma execução à mão; “Importar planilha da B3” lê o extrato de Negociação da Área do Investidor.",
          "Agrupe as execuções em operações para acompanhar o resultado de cada uma.",
          "“Nova operação” abre o montador: monte a estrutura perna a perna e veja payoff, gregas, pontos de equilíbrio e perda máxima.",
          "Séries vencidas esperam a sua confirmação antes de qualquer liquidação.",
        ],
      },
      "/diario": {
        summary: "Todas as decisões que você registrou, pontuadas quando chega o horizonte.",
        steps: [
          "Cada registro mostra a decisão, sua justificativa, o horizonte e, depois dele, a pontuação.",
          "O painel de histórico de acertos mostra como suas decisões envelheceram.",
        ],
      },
      "/configuracoes": {
        summary: "Sua conta e a aparência da estação.",
        steps: [
          "Declare capital e limites de risco; sem eles, a precificação mostra a etiqueta “sem perfil de risco”.",
          "Escolha um tema: Instrumento, Terminal ou Amplo.",
          "Exporte seus dados, confira o registro de acesso ou exclua sua conta.",
        ],
      },
    } satisfies Record<DestinationHref, DestinationGuide>,
  },
} satisfies typeof en;

export const helpStrings = { en, ptBR } as const;

export const t = helpStrings.ptBR;
