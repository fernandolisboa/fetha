import Link from "next/link";

import { Panel } from "@/modules/shell";

import { t } from "../../strings";
import { getMyRollAgenda } from "../roll-agenda-queries";
import type { RollAgendaAction } from "../roll-agenda";

const labels = t.roll.agenda;

function toneOf(action: RollAgendaAction): string | undefined {
  if (action === "close_early_assignment_risk") return "var(--danger)";
  if (action === "roll") return "var(--warning)";
  return undefined;
}

export async function RollAgendaPanel() {
  const items = await getMyRollAgenda();

  return (
    <Panel title={labels.title} subtitle={labels.subtitle}>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {items.map((item) => (
            <li
              key={item.operationId}
              className="flex items-center justify-between gap-3 py-2 text-[13px]"
            >
              <span>
                <Link
                  href="/carteira"
                  className="font-mono uppercase underline-offset-4 hover:underline"
                >
                  {item.underlying}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {labels.sessionsToExpiry(item.sessionsToExpiry)}
                </span>
              </span>
              <span className="font-mono text-[12px]" style={{ color: toneOf(item.action) }}>
                {labels.actions[item.action]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
