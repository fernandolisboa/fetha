const en = {
  panel: {
    title: "Manual ingestion trigger",
    subtitle: "Owner-only: runs the same nightly job Vercel Cron runs, on demand.",
    sessionLabel: "Session (optional)",
    sessionPlaceholder: "Leave empty for the latest open session",
    submit: "Run ingestion now",
    running: "Running…",
    resultTitle: "Last run",
    ok: "Completed",
    failed: "Failed",
    forbidden: "You are not allowed to run this.",
    invalidInput: "That session date is not valid.",
    unexpectedError: "Something went wrong; try again.",
    session: "Session",
    sources: "Sources",
    sourceOk: "ok",
    sourceSkipped: "skipped",
    sourceFailed: "failed",
    evaluationSkipped: "not run",
    signalsWritten: (count: number) => `${String(count)} signals written`,
    decisionsScored: (count: number) => `${String(count)} decisions scored`,
  },
};

const ptBR = {
  panel: {
    title: "Disparo manual da ingestão",
    subtitle: "Só o dono: roda o mesmo job noturno do Vercel Cron, sob demanda.",
    sessionLabel: "Sessão (opcional)",
    sessionPlaceholder: "Deixe em branco para a última sessão aberta",
    submit: "Rodar ingestão agora",
    running: "Rodando…",
    resultTitle: "Última execução",
    ok: "Concluída",
    failed: "Falhou",
    forbidden: "Você não tem permissão para rodar isso.",
    invalidInput: "Essa data de sessão não é válida.",
    unexpectedError: "Algo deu errado; tente de novo.",
    session: "Sessão",
    sources: "Fontes",
    sourceOk: "ok",
    sourceSkipped: "pulada",
    sourceFailed: "falhou",
    evaluationSkipped: "não rodou",
    signalsWritten: (count: number) => `${String(count)} sinais gerados`,
    decisionsScored: (count: number) => `${String(count)} decisões pontuadas`,
  },
} satisfies typeof en;

export const nightlyStrings = { en, ptBR } as const;

export const t = nightlyStrings.ptBR;
