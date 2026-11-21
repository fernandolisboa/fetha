import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { getMyOperationSummary, RollChainHistory, t } from "@/modules/portfolio";
import { PageHeader, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.portfolio}` };

export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const operation = await getMyOperationSummary(id);
  if (!operation) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <PageHeader
        overline={shellStrings.destinations.portfolio}
        headline={
          <>
            <span className="font-mono uppercase">{operation.underlying}</span>{" "}
            <span className="text-muted-foreground text-[15px]">
              {t.dashboard.operations.statuses[operation.status]}
            </span>
          </>
        }
      />
      <RollChainHistory operationId={id} />
    </div>
  );
}
