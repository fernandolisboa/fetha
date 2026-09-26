import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import {
  comparedRunIds,
  CompareRunsPicker,
  ComparisonView,
  getMyComparison,
  MAX_COMPARED_RUNS,
  requestedRunIds,
  t,
} from "@/modules/backtests";
import { Panel } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.compare.title}` };

export default async function CompareBacktestsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  await requireUser();
  const { run } = await searchParams;
  const requested = requestedRunIds(run).length;
  const ids = comparedRunIds(run);
  const { groups, runs } = await getMyComparison(ids);

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.compare.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{t.compare.title}</h1>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          {requested > MAX_COMPARED_RUNS ? (
            <p className="text-warning text-xs">
              {t.compare.tooMany.replace("{max}", String(MAX_COMPARED_RUNS))}
            </p>
          ) : null}
          {runs.length >= 2 ? (
            <ComparisonView runs={runs} />
          ) : (
            <Panel>
              <p className="text-muted-foreground text-sm">{t.compare.tooFew}</p>
            </Panel>
          )}
        </div>
        <Panel title={t.compare.pickTitle} className="self-start">
          <CompareRunsPicker
            key={runs.map((compared) => compared.id).join("|")}
            groups={groups}
            initialSelection={runs.map((compared) => compared.id)}
          />
        </Panel>
      </div>
    </div>
  );
}
