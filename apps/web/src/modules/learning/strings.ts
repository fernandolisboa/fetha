const en = {
  overline: "Learn",
  headline: "Learn",
  learnStructureLink: (name: string) => `Learn: ${name}`,
  viewBy: {
    label: "View by",
    jornada: "Journey",
    temas: "Topics",
    estruturas: "Structures",
  },
  continueCard: {
    title: "Continue",
    cta: "Continue",
    allDone: "You passed every lesson. Come back whenever a new one ships.",
    minutes: (minutes: number) => `${String(minutes)} min`,
  },
  levelProgress: (done: number, total: number) => `${String(done)} of ${String(total)}`,
  comingSoon: "Coming soon",
  lessonDone: "Done",
  lessonMinutes: (minutes: number) => `${String(minutes)} min`,
  lessonList: {
    title: "Lessons",
  },
  quiz: {
    title: "Quiz",
    submit: "Submit answers",
    submitting: "Submitting…",
    retry: "Try again",
    nextLesson: "Next lesson",
    backToLessons: "Back to Learn",
    score: (correct: number, total: number) => `${String(correct)} of ${String(total)} correct`,
    passed: "Passed — this lesson is marked done.",
    failed: "Not quite 75% yet. Review the explanations and try again.",
    answerEvery: "Answer every question before submitting.",
    error: "Could not submit the quiz. Try again.",
    rateLimited: "Too many attempts in a row. Wait a few seconds and try again.",
    correct: "Correct",
    incorrect: "Incorrect",
  },
};

const ptBR = {
  overline: "Aprender",
  headline: "Aprender",
  learnStructureLink: (name: string) => `Aprender: ${name}`,
  viewBy: {
    label: "Ver por",
    jornada: "Jornada",
    temas: "Temas",
    estruturas: "Estruturas",
  },
  continueCard: {
    title: "Continuar",
    cta: "Continuar",
    allDone: "Você passou em todas as lições. Volte quando sair uma nova.",
    minutes: (minutes: number) => `${String(minutes)} min`,
  },
  levelProgress: (done: number, total: number) => `${String(done)} de ${String(total)}`,
  comingSoon: "Em breve",
  lessonDone: "Concluída",
  lessonMinutes: (minutes: number) => `${String(minutes)} min`,
  lessonList: {
    title: "Lições",
  },
  quiz: {
    title: "Quiz",
    submit: "Enviar respostas",
    submitting: "Enviando…",
    retry: "Tentar de novo",
    nextLesson: "Próxima lição",
    backToLessons: "Voltar para Aprender",
    score: (correct: number, total: number) => `${String(correct)} de ${String(total)} corretas`,
    passed: "Aprovado — esta lição está marcada como concluída.",
    failed: "Ainda não chegou a 75%. Revise as explicações e tente de novo.",
    answerEvery: "Responda todas as perguntas antes de enviar.",
    error: "Não foi possível enviar o quiz. Tente novamente.",
    rateLimited: "Muitas tentativas seguidas. Espere alguns segundos e tente de novo.",
    correct: "Correta",
    incorrect: "Incorreta",
  },
} satisfies typeof en;

export const learningStrings = { en, ptBR } as const;

export const t = learningStrings.ptBR;
