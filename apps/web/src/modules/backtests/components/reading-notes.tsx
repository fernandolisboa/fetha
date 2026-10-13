import Link from "next/link";

import { Panel } from "@/modules/shell";

import { t } from "../strings";

export function ReadingNotes({ strategyId }: { strategyId: string }) {
  return (
    <Panel title={t.readingNotes.title}>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-pretty">
        {t.readingNotes.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="text-sm text-pretty">
        {t.readingNotes.nextStep}{" "}
        <Link
          href={`/estrategias/${strategyId}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t.readingNotes.strategyLink}
        </Link>
      </p>
    </Panel>
  );
}
