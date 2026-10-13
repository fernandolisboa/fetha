const en = {
  panel: {
    title: "Use a recipe",
    subtitle:
      "Say what you expect from {ticker}: Fetha builds a ready-made strategy and tests it on history.",
  },
  picker: {
    moveQuestion: "What do you expect from {ticker}?",
    moves: {
      up: "To rise",
      down: "To fall",
      sideways: "To move sideways",
      big_move: "A big move, either way",
    },
    riskQuestion: "How much do you accept to lose per operation?",
    risks: {
      "0.01": "Little: 1% of your capital",
      "0.02": "Some: 2% of your capital",
      "0.05": "A lot: 5% of your capital",
    },
    riskAmount: "about {amount}",
    noRiskProfile: "To test a recipe, first declare your capital in Settings.",
    noRiskProfileLink: "Open Settings",
    pickMove: "Choose what you expect to see the recipes.",
    listTitle: "Recipes for this expectation",
    ivRegimes: {
      low: "Best when volatility is low",
      high: "Best when volatility is high",
      any: "Works with any volatility",
    },
    sketchLabel: "Shape of the result at expiry: an illustration, not a price",
    start: "Create and test",
    starting: "Creating and testing…",
    footnote:
      "The recipe becomes a strategy of yours that you can edit. If {ticker} is not on your watchlist yet, it is added. Fetha tests the last two years and opens the report. Signals only show up after you turn the strategy on.",
  },
  errors: {
    invalid: "Couldn't use this recipe. Try again.",
    no_risk_profile: "To test a recipe, first declare your capital in Settings.",
    no_data: "There are no quotes for {ticker} to test yet.",
    index_in_universe: "{ticker} is a market index, not a tradable instrument: it has no recipe.",
    watchlist_full: "Your watchlist is full (100 instruments). Remove one to use the recipe.",
    rate_limited: "Too many attempts in a row. Wait a minute and try again.",
    limit_reached: "You reached the strategy limit. Archive one to create another.",
    too_many_active:
      "The strategy was created, but you already have too many backtests running. Open the strategy and run the test later.",
    unavailable: "Couldn't save right now. Try again.",
    strategyLink: "Open the strategy",
  },
  strategyName: "{structure} on {ticker}",
  recipes: {
    "bull-call-spread-low-iv": {
      summary:
        "Buys a call at today's price and sells another 5% above. Gains if the stock rises up to the upper one.",
      maxLoss: "Max loss: what you pay to set it up.",
    },
    "long-call-low-iv": {
      summary: "Buys a call at today's price. Gains more the more the stock rises.",
      maxLoss: "Max loss: what you pay for the call.",
    },
    "bull-put-spread-high-iv": {
      summary:
        "Sells a put at today's price and buys another 5% below. You receive at setup and keep it if the stock does not fall.",
      maxLoss: "Max loss: the distance between the puts minus what you received.",
    },
    "covered-call-high-iv": {
      summary:
        "Buys the stock and sells a call 5% above. Earns an extra while you wait, but gives up the rise past the call.",
      maxLoss:
        "Max loss: the stock's own, cushioned by what you receive for the call. The size follows the full stock price, so with a small capital the operation is small.",
    },
    "bear-put-spread-low-iv": {
      summary:
        "Buys a put at today's price and sells another 5% below. Gains if the stock falls down to the lower one.",
      maxLoss: "Max loss: what you pay to set it up.",
    },
    "long-put-low-iv": {
      summary: "Buys a put at today's price. Gains more the more the stock falls.",
      maxLoss: "Max loss: what you pay for the put.",
    },
    "bear-call-spread-high-iv": {
      summary:
        "Sells a call at today's price and buys another 5% above. You receive at setup and keep it if the stock does not rise.",
      maxLoss: "Max loss: the distance between the calls minus what you received.",
    },
    "call-butterfly": {
      summary:
        "Buys calls 5% below and 5% above and sells two at today's price. Gains most if the stock ends near where it is.",
      maxLoss: "Max loss: what you pay to set it up.",
    },
    "long-straddle-low-iv": {
      summary:
        "Buys a call and a put at today's price. Gains if the stock moves a lot, up or down.",
      maxLoss: "Max loss: what you pay for both.",
    },
    "long-strangle-low-iv": {
      summary:
        "Buys a put 5% below and a call 5% above. Cheaper than the straddle, but needs a bigger move.",
      maxLoss: "Max loss: what you pay for both.",
    },
  },
};

const ptBR = {
  panel: {
    title: "Usar uma receita",
    subtitle:
      "Diga o que você espera de {ticker}: o Fetha monta uma estratégia pronta e testa no histórico.",
  },
  picker: {
    moveQuestion: "O que você espera de {ticker}?",
    moves: {
      up: "Que suba",
      down: "Que caia",
      sideways: "Que fique de lado",
      big_move: "Que se mexa muito, para qualquer lado",
    },
    riskQuestion: "Quanto você aceita perder por operação?",
    risks: {
      "0.01": "Pouco: 1% do capital",
      "0.02": "Médio: 2% do capital",
      "0.05": "Bastante: 5% do capital",
    },
    riskAmount: "cerca de {amount}",
    noRiskProfile: "Para testar uma receita, informe antes o seu capital em Configurações.",
    noRiskProfileLink: "Abrir Configurações",
    pickMove: "Escolha o que você espera para ver as receitas.",
    listTitle: "Receitas para essa expectativa",
    ivRegimes: {
      low: "Melhor com volatilidade baixa",
      high: "Melhor com volatilidade alta",
      any: "Serve com qualquer volatilidade",
    },
    sketchLabel: "Formato do resultado no vencimento: uma ilustração, não um preço",
    start: "Criar e testar",
    starting: "Criando e testando…",
    footnote:
      "A receita vira uma estratégia sua, que você pode editar. Se {ticker} ainda não estiver na sua watchlist, ele entra nela. O Fetha testa os últimos dois anos e abre o relatório. Sinais só aparecem depois que você ativar a estratégia.",
  },
  errors: {
    invalid: "Não foi possível usar essa receita. Tente novamente.",
    no_risk_profile: "Para testar uma receita, informe antes o seu capital em Configurações.",
    no_data: "Ainda não há cotações de {ticker} para testar.",
    index_in_universe: "{ticker} é um índice de mercado, não um ativo negociável: não tem receita.",
    watchlist_full: "Sua watchlist está cheia (100 ativos). Remova um para usar a receita.",
    rate_limited: "Muitas tentativas seguidas. Espere um minuto e tente de novo.",
    limit_reached: "Você chegou ao limite de estratégias. Arquive uma para criar outra.",
    too_many_active:
      "A estratégia foi criada, mas você já tem backtests demais em andamento. Abra a estratégia e rode o teste depois.",
    unavailable: "Não foi possível salvar agora. Tente novamente.",
    strategyLink: "Abrir a estratégia",
  },
  strategyName: "{structure} em {ticker}",
  recipes: {
    "bull-call-spread-low-iv": {
      summary:
        "Compra uma call no preço atual e vende outra 5% acima. Ganha se o ativo subir até a de cima.",
      maxLoss: "Perda máxima: o que você paga para montar.",
    },
    "long-call-low-iv": {
      summary: "Compra uma call no preço atual. Quanto mais o ativo subir, mais ganha.",
      maxLoss: "Perda máxima: o que você paga pela call.",
    },
    "bull-put-spread-high-iv": {
      summary:
        "Vende uma put no preço atual e compra outra 5% abaixo. Você recebe na montagem e fica com o valor se o ativo não cair.",
      maxLoss: "Perda máxima: a distância entre as puts menos o que você recebeu.",
    },
    "covered-call-high-iv": {
      summary:
        "Compra a ação e vende uma call 5% acima. Rende um extra enquanto você espera, mas abre mão da alta além da call.",
      maxLoss:
        "Perda máxima: a da própria ação, amortecida pelo que você recebe pela call. O tamanho segue o preço cheio da ação, então com pouco capital a operação fica pequena.",
    },
    "bear-put-spread-low-iv": {
      summary:
        "Compra uma put no preço atual e vende outra 5% abaixo. Ganha se o ativo cair até a de baixo.",
      maxLoss: "Perda máxima: o que você paga para montar.",
    },
    "long-put-low-iv": {
      summary: "Compra uma put no preço atual. Quanto mais o ativo cair, mais ganha.",
      maxLoss: "Perda máxima: o que você paga pela put.",
    },
    "bear-call-spread-high-iv": {
      summary:
        "Vende uma call no preço atual e compra outra 5% acima. Você recebe na montagem e fica com o valor se o ativo não subir.",
      maxLoss: "Perda máxima: a distância entre as calls menos o que você recebeu.",
    },
    "call-butterfly": {
      summary:
        "Compra calls 5% abaixo e 5% acima e vende duas no preço atual. Ganha mais se o ativo terminar perto de onde está.",
      maxLoss: "Perda máxima: o que você paga para montar.",
    },
    "long-straddle-low-iv": {
      summary:
        "Compra uma call e uma put no preço atual. Ganha se o ativo andar bastante, para cima ou para baixo.",
      maxLoss: "Perda máxima: o que você paga pelas duas.",
    },
    "long-strangle-low-iv": {
      summary:
        "Compra uma put 5% abaixo e uma call 5% acima. Sai mais barato que o straddle, mas precisa de um movimento maior.",
      maxLoss: "Perda máxima: o que você paga pelas duas.",
    },
  },
} satisfies typeof en;

export const recipesStrings = { en, ptBR } as const;

export const t = recipesStrings.ptBR;
