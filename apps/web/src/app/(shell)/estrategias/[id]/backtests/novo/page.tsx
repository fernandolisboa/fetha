import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/modules/auth";
import { CreateRunForm, t } from "@/modules/backtests";
import { getMyStrategy, StrategyNotFoundError } from "@/modules/strategies";
import { Panel } from "@/modules/shell";
import { getMyWatchlist } from "@/modules/watchlist";

export const metadata: Metadata = { title: `Fetha · ${t.create.title}` };

export default async function NewBacktestRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const [strategy, watchlist] = await Promise.all([
    getMyStrategy(id).catch((error: unknown) => {
      if (error instanceof StrategyNotFoundError) return null;
      throw error;
    }),
    getMyWatchlist(),
  ]);

  if (!strategy) {
    notFound();
  }
  const latestVersion = strategy.versions[strategy.versions.length - 1];
  if (!latestVersion) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.create.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{strategy.name}</h1>
      </div>

      <Panel>
        {watchlist.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.create.empty}</p>
        ) : (
          <CreateRunForm
            strategyId={strategy.id}
            strategyVersionId={latestVersion.id}
            watchlistTickers={watchlist.map((item) => item.ticker)}
          />
        )}
      </Panel>
    </div>
  );
}
