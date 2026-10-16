import type { AccessEvent } from "./events";

const totalFormatter = new Intl.NumberFormat("pt-BR");

const en = {
  accessLog: {
    title: "Access log",
    subtitle:
      "Each time a portfolio or decisions screen is opened and each data export, with the address and device it came from. Entries are kept for 180 days.",
    empty: "No access recorded yet.",
    event: "Access",
    origin: "Origin",
    unknown: "Unknown",
    viewAll: "View full log",
    events: {
      portfolio_read: "Portfolio read",
      decisions_read: "Decisions read",
      data_export: "Data exported",
      nightly_triggered: "Manual ingestion triggered",
      corporate_action_recorded: "Corporate-action factor recorded",
    } satisfies Record<AccessEvent, string>,
    dialog: {
      title: "Full access log",
      from: "From",
      to: "To",
      eventFilter: "Access type",
      originFilter: "Origin",
      allEvents: "All",
      allOrigins: "All",
      clearFilters: "Clear filters",
      total: (count: number) => `${String(count)} ${count === 1 ? "access" : "accesses"}`,
      loading: "Loading…",
      loadMore: "Load more",
      retry: "Try again",
      emptyFiltered: "No access matches these filters.",
      errors: {
        rate_limited: "Too many requests. Try again in a few seconds.",
        unavailable: "Could not load the access log right now.",
        invalid: "Could not load the access log right now.",
        range: "The start date must not be after the end date.",
      },
    },
  },
};

const ptBR = {
  accessLog: {
    title: "Registro de acesso",
    subtitle:
      "Cada abertura de uma tela da sua carteira ou das suas decisões e cada exportação de dados, com o endereço e o dispositivo de origem. Os registros ficam guardados por 180 dias.",
    empty: "Nenhum acesso registrado ainda.",
    event: "Acesso",
    origin: "Origem",
    unknown: "Desconhecido",
    viewAll: "Ver registro completo",
    events: {
      portfolio_read: "Leitura da carteira",
      decisions_read: "Leitura das decisões",
      data_export: "Exportação dos dados",
      nightly_triggered: "Disparo manual da ingestão",
      corporate_action_recorded: "Fator de evento corporativo registrado",
    },
    dialog: {
      title: "Registro de acesso completo",
      from: "De",
      to: "Até",
      eventFilter: "Tipo de acesso",
      originFilter: "Origem",
      allEvents: "Todos",
      allOrigins: "Todas",
      clearFilters: "Limpar filtros",
      total: (count: number) =>
        `${totalFormatter.format(count)} ${count === 1 ? "acesso" : "acessos"}`,
      loading: "Carregando…",
      loadMore: "Carregar mais",
      retry: "Tentar de novo",
      emptyFiltered: "Nenhum acesso com esses filtros.",
      errors: {
        rate_limited: "Muitas requisições em pouco tempo. Tente de novo em alguns segundos.",
        unavailable: "Não foi possível carregar o registro agora.",
        invalid: "Não foi possível carregar o registro agora.",
        range: "A data inicial não pode ser depois da final.",
      },
    },
  },
} satisfies typeof en;

export const auditStrings = { en, ptBR } as const;

export const t = auditStrings.ptBR;
