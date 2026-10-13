const countFormatterEn = new Intl.NumberFormat("en-US");
const countFormatterPtBR = new Intl.NumberFormat("pt-BR");

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
    busy: "A run is already in progress; wait for it to finish.",
    unexpectedError: "Something went wrong; try again.",
    session: "Session",
    sources: "Sources",
    sourceOk: "ok",
    sourceSkipped: "skipped",
    sourcePending: "not published yet",
    sourceFailed: "failed",
    evaluationSkipped: "not run",
    signalsWritten: (count: number) => `${String(count)} signals written`,
    decisionsScored: (count: number) => `${String(count)} decisions scored`,
    analysesScored: (count: number) => `${String(count)} AI analyses scored`,
    radar: (scanned: number, universe: number, matches: number) =>
      `Radar: ${String(scanned)} of ${String(universe)} underlyings read, ${String(matches)} recipe entries`,
    radarSkipped: "Radar: not run",
    evaluationErrors: (count: number) => `${countFormatterEn.format(count)} evaluation errors`,
    scoringErrors: (count: number) => `${countFormatterEn.format(count)} scoring errors`,
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
    busy: "Já tem uma execução em andamento; aguarde ela terminar.",
    unexpectedError: "Algo deu errado; tente de novo.",
    session: "Sessão",
    sources: "Fontes",
    sourceOk: "ok",
    sourceSkipped: "pulada",
    sourcePending: "ainda não publicada",
    sourceFailed: "falhou",
    evaluationSkipped: "não rodou",
    signalsWritten: (count: number) => `${String(count)} sinais gerados`,
    decisionsScored: (count: number) => `${String(count)} decisões pontuadas`,
    analysesScored: (count: number) => `${String(count)} análises de IA pontuadas`,
    radar: (scanned: number, universe: number, matches: number) =>
      `Radar: ${String(scanned)} de ${String(universe)} ativos lidos, ${String(matches)} entradas de receitas`,
    radarSkipped: "Radar: não rodou",
    evaluationErrors: (count: number) => `${countFormatterPtBR.format(count)} erros na avaliação`,
    scoringErrors: (count: number) => `${countFormatterPtBR.format(count)} erros na pontuação`,
  },
} satisfies typeof en;

export const nightlyStrings = { en, ptBR } as const;

export const t = nightlyStrings.ptBR;
