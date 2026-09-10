import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/format/date-time";
import { requireUser } from "@/modules/auth";
import { Panel, t as shellStrings } from "@/modules/shell";
import {
  getMyStrategy,
  getStructures,
  ShareToggleButton,
  StrategyEditorForm,
  StrategyNotFoundError,
  t,
} from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.strategies}` };

export default async function EditStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const [structures, strategy] = await Promise.all([
    getStructures(),
    getMyStrategy(id).catch((error: unknown) => {
      if (error instanceof StrategyNotFoundError) {
        return null;
      }
      throw error;
    }),
  ]);

  if (!strategy) {
    notFound();
  }

  const latestVersion = strategy.versions[strategy.versions.length - 1];
  if (!latestVersion) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {t.editor.editOverline}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight">{strategy.name}</h1>
        </div>
        <ShareToggleButton strategyId={strategy.id} visibility={strategy.visibility} />
      </div>

      <StrategyEditorForm
        structures={structures}
        strategyId={strategy.id}
        initial={latestVersion.definition}
      />

      <Panel title={t.editor.versions.title}>
        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {strategy.versions.map((version) => (
            <li key={version.id} className="font-mono tabular-nums">
              v{version.versionNumber} · {t.editor.versions.createdAt}{" "}
              {formatDateTime(version.createdAt)}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
