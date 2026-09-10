import Link from "next/link";
import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { formatBRL } from "@/lib/format/brl";
import { getMyOperations, t } from "@/modules/operations";
import { EmptyState, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.portfolio}` };

export default async function PortfolioPage() {
  await requireUser();
  const operations = await getMyOperations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {shellStrings.destinations.portfolio}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight">{t.list.title}</h1>
        </div>
        <Link
          href="/carteira/nova-operacao"
          className="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-2 text-[13px] font-medium"
        >
          {t.list.newOperation}
        </Link>
      </div>

      {operations.length === 0 ? (
        <EmptyState sentence={t.list.empty} />
      ) : (
        <ul className="flex flex-col gap-2">
          {operations.map((operation) => (
            <li
              key={operation.id}
              className="border-border bg-card flex items-center justify-between rounded-[var(--radius)] border p-3"
            >
              <span className="font-mono text-[13px] uppercase">{operation.underlying}</span>
              <span className="font-mono text-[13px]">
                {formatBRL(operation.netPremiumCentavos)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
