import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/auth";
import { EmptyState, Panel, t as shellStrings } from "@/modules/shell";
import {
  CopyStrategyButton,
  getMyStrategies,
  getSharedStrategies,
  ShareToggleButton,
  t,
} from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.strategies}` };

export default async function StrategiesPage() {
  await requireUser();
  const [mine, shared] = await Promise.all([getMyStrategies(), getSharedStrategies()]);

  if (mine.length === 0 && shared.length === 0) {
    return (
      <EmptyState
        sentence={shellStrings.emptyStates.strategies.sentence}
        action={{ label: t.list.newStrategy, href: "/estrategias/nova" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {t.list.overline}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight">{t.list.title}</h1>
        </div>
        <Link href="/estrategias/nova" className={buttonVariants()}>
          {t.list.newStrategy}
        </Link>
      </div>

      <Panel title={t.list.mine.title}>
        {mine.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.list.mine.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.list.mine.columns.name}</th>
                <th className="py-2 font-normal">{t.list.mine.columns.visibility}</th>
                <th className="py-2 text-right font-normal">{t.list.mine.columns.version}</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {mine.map((strategy) => (
                <tr key={strategy.id} className="border-line-soft border-b">
                  <td className="py-2">
                    <Link
                      href={`/estrategias/${strategy.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {strategy.name}
                    </Link>
                  </td>
                  <td className="py-2">{t.list.visibility[strategy.visibility]}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    v{strategy.latestVersionNumber}
                  </td>
                  <td className="py-2 text-right">
                    <ShareToggleButton strategyId={strategy.id} visibility={strategy.visibility} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={t.list.shared.title}>
        {shared.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.list.shared.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.list.mine.columns.name}</th>
                <th className="py-2 text-right font-normal">{t.list.mine.columns.version}</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {shared.map((strategy) => (
                <tr key={strategy.id} className="border-line-soft border-b">
                  <td className="py-2">{strategy.name}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    v{strategy.latestVersionNumber}
                  </td>
                  <td className="py-2 text-right">
                    <CopyStrategyButton sourceStrategyId={strategy.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
