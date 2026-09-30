import type { AccessEvent } from "./events";

const en = {
  accessLog: {
    title: "Access log",
    subtitle:
      "Each read or export of your portfolio and decision data, with the address and device it came from. Entries are kept for 180 days.",
    empty: "No access recorded yet.",
    event: "Access",
    origin: "Origin",
    unknown: "Unknown",
    showMore: "Show more",
    events: {
      portfolio_read: "Portfolio read",
      decisions_read: "Decisions read",
      data_export: "Data exported",
      nightly_triggered: "Manual ingestion triggered",
      corporate_action_recorded: "Corporate-action factor recorded",
    } satisfies Record<AccessEvent, string>,
  },
};

const ptBR = {
  accessLog: {
    title: "Registro de acesso",
    subtitle:
      "Cada leitura ou exportação dos dados da sua carteira e das suas decisões, com o endereço e o dispositivo de origem. Os registros ficam guardados por 180 dias.",
    empty: "Nenhum acesso registrado ainda.",
    event: "Acesso",
    origin: "Origem",
    unknown: "Desconhecido",
    showMore: "Ver mais",
    events: {
      portfolio_read: "Leitura da carteira",
      decisions_read: "Leitura das decisões",
      data_export: "Exportação dos dados",
      nightly_triggered: "Disparo manual da ingestão",
      corporate_action_recorded: "Fator de evento corporativo registrado",
    },
  },
} satisfies typeof en;

export const auditStrings = { en, ptBR } as const;

export const t = auditStrings.ptBR;
