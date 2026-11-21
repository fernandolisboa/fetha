"use client";

import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";

import { t } from "../../strings";
import { downloadRollChainCsvAction } from "../roll-chain-actions";

export function RollChainDownloadButton({ operationId }: { operationId: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        setPending(true);
        startTransition(() => {
          downloadRollChainCsvAction(operationId)
            .then((result) => {
              setPending(false);
              if (result.status !== "ok") return;
              const blob = new Blob([result.csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `rolagens-${operationId}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            })
            .catch(() => {
              setPending(false);
            });
        });
      }}
    >
      {t.roll.chain.download}
    </Button>
  );
}
