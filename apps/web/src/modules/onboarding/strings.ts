import type { DestinationHref } from "@/modules/shell/client";

interface DestinationGuide {
  summary: string;
  steps: string[];
}

const en = {
  guide: {
    title: "How to use Fetha",
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
        "Ctrl K searches an instrument, an option series or a strategy.",
        "The market bar shows the reference prices and how fresh they are, such as “fechamento de ontem”.",
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
  guide: {
    title: "Como usar a Fetha",
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
        "Ctrl K busca um ativo, uma série de opções ou uma estratégia.",
        "A barra de mercado mostra os preços de referência e de quando eles são, como “fechamento de ontem”.",
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
          "Compartilhe uma estratégia só para leitura, copie as que outros compartilharam e arquive as que não usa mais.",
        ],
      },
      "/carteira": {
        summary:
          "Suas posições reais, lançadas por você e marcadas a mercado pelo último fechamento.",
        steps: [
          "“Registrar execução” lança uma execução à mão; “Importar planilha da B3” lê o extrato de negociação da Área do Investidor.",
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

export const onboardingStrings = { en, ptBR } as const;

export const t = onboardingStrings.ptBR;
