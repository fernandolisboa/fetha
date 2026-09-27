import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/modules/auth";
import { getMyActiveBacktestRuns, t as backtestsStrings } from "@/modules/backtests";
import { DiscardRunButton } from "@/modules/backtests/client";
import { EmptyState, PageHeader, Panel, t as shellStrings } from "@/modules/shell";
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
  const [mine, shared, active] = await Promise.all([
    getMyStrategies(),
    getSharedStrategies(),
    getMyActiveBacktestRuns(),
  ]);

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
      <PageHeader
        overline={t.list.overline}
        headline={t.list.title}
        actions={
          <div className="flex gap-2">
            <Link href="/estrategias/comparar" className={buttonVariants({ variant: "outline" })}>
              {backtestsStrings.compare.link}
            </Link>
            <Link href="/estrategias/nova" className={buttonVariants()}>
              {t.list.newStrategy}
            </Link>
          </div>
        }
      />

      <div id="em-andamento">
        <Panel title={backtestsStrings.inProgress.title}>
          {active.length === 0 ? (
            <p className="text-muted-foreground text-sm">{backtestsStrings.inProgress.empty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{backtestsStrings.inProgress.columns.strategy}</TableHead>
                  <TableHead>{backtestsStrings.inProgress.columns.period}</TableHead>
                  <TableHead>{backtestsStrings.inProgress.columns.status}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link
                        href={`/estrategias/${run.strategyId}/backtests/${run.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {run.strategyName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{run.period}</TableCell>
                    <TableCell>{backtestsStrings.inProgress.statusLabels[run.status]}</TableCell>
                    <TableCell className="py-0 text-right">
                      <DiscardRunButton
                        runId={run.id}
                        runLabel={`${run.strategyName} (${run.period})`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <Panel title={t.list.mine.title}>
        {mine.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.list.mine.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.list.mine.columns.name}</TableHead>
                <TableHead>{t.list.mine.columns.visibility}</TableHead>
                <TableHead className="text-right">{t.list.mine.columns.version}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((strategy) => (
                <TableRow key={strategy.id}>
                  <TableCell>
                    <Link
                      href={`/estrategias/${strategy.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {strategy.name}
                    </Link>
                  </TableCell>
                  <TableCell>{t.list.visibility[strategy.visibility]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    v{strategy.latestVersionNumber}
                  </TableCell>
                  <TableCell className="py-0 text-right">
                    <ShareToggleButton
                      strategyId={strategy.id}
                      strategyName={strategy.name}
                      visibility={strategy.visibility}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title={t.list.shared.title}>
        {shared.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.list.shared.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.list.mine.columns.name}</TableHead>
                <TableHead className="text-right">{t.list.mine.columns.version}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shared.map((strategy) => (
                <TableRow key={strategy.id}>
                  <TableCell>{strategy.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    v{strategy.latestVersionNumber}
                  </TableCell>
                  <TableCell className="py-0 text-right">
                    <CopyStrategyButton
                      sourceStrategyId={strategy.id}
                      strategyName={strategy.name}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
