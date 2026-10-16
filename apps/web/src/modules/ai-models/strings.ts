const en = {
  panel: {
    title: "AI analyses",
    subtitle: "Pick a model family per analysis kind, and optionally your own Anthropic key.",
  },
  families: {
    default: "Default",
    haiku: "Haiku",
    sonnet: "Sonnet",
    opus: "Opus",
  },
  kinds: {
    signal: "Signals",
    contemplated_operation: "Contemplated operations",
    held_operation: "Held operations",
    backtest_run: "Backtests",
    suggestion: "Suggestions",
  },
  usingModel: (name: string) => `using ${name}`,
  apiKey: {
    title: "Your Anthropic key",
    serverKey: "Using the server's key",
    ownKey: (last4: string) => `Your own key, ending ••••${last4}`,
    unreadable: "Your key could not be read; save it again",
    placeholder: "sk-ant-...",
    save: "Save",
    test: "Test",
    remove: "Remove",
    saving: "Saving…",
    testing: "Testing…",
    removing: "Removing…",
    saved: "Key saved.",
    removed: "Key removed.",
    testOk: "The key works.",
    errors: {
      invalid: "That does not look like an Anthropic key.",
      key_invalid: "Anthropic rejected this key.",
      key_unreachable: "Could not reach Anthropic right now. Try again in a moment.",
      rate_limited: "Too many attempts recently. Try again in a moment.",
      unavailable: "Couldn't save right now. Try again in a moment.",
      no_key: "No key is stored.",
    },
  },
};

const ptBR: typeof en = {
  panel: {
    title: "Análises por IA",
    subtitle:
      "Escolha a família de modelo por tipo de análise e, se quiser, sua própria chave da Anthropic.",
  },
  families: {
    default: "Padrão",
    haiku: "Haiku",
    sonnet: "Sonnet",
    opus: "Opus",
  },
  kinds: {
    signal: "Sinais",
    contemplated_operation: "Operações em estudo",
    held_operation: "Operações em carteira",
    backtest_run: "Backtests",
    suggestion: "Sugestões",
  },
  usingModel: (name: string) => `usando ${name}`,
  apiKey: {
    title: "Sua chave da Anthropic",
    serverKey: "Usando a chave do servidor",
    ownKey: (last4: string) => `Sua chave, terminada em ••••${last4}`,
    unreadable: "Sua chave não pôde ser lida; salve de novo",
    placeholder: "sk-ant-...",
    save: "Salvar",
    test: "Testar",
    remove: "Remover",
    saving: "Salvando…",
    testing: "Testando…",
    removing: "Removendo…",
    saved: "Chave salva.",
    removed: "Chave removida.",
    testOk: "A chave funciona.",
    errors: {
      invalid: "Isso não parece uma chave da Anthropic.",
      key_invalid: "A Anthropic recusou essa chave.",
      key_unreachable:
        "Não foi possível falar com a Anthropic agora. Tente novamente em instantes.",
      rate_limited: "Muitas tentativas em pouco tempo. Tente novamente em instantes.",
      unavailable: "Não foi possível salvar agora. Tente novamente em instantes.",
      no_key: "Nenhuma chave está salva.",
    },
  },
};

export const aiModelsStrings = { en, ptBR } as const;
export const t = aiModelsStrings.ptBR;
