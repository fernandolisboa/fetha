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
    events: {
      portfolio_read: "Portfolio read",
      decisions_read: "Decisions read",
      data_export: "Data exported",
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
    events: {
      portfolio_read: "Leitura da carteira",
      decisions_read: "Leitura das decisões",
      data_export: "Exportação dos dados",
    },
  },
} satisfies typeof en;

export const auditStrings = { en, ptBR } as const;

export const t = auditStrings.ptBR;
