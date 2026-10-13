"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { addToWatchlistAction } from "../actions";
import { t } from "../strings";

export function AddToWatchlistButton({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"invalid" | "cap" | null>(null);

  function add() {
    setError(null);
    setPending(true);
    startTransition(() => {
      addToWatchlistAction({ ticker })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.refresh();
          } else {
            setError(result.error);
          }
        })
        .catch(() => {
          setPending(false);
          setError("invalid");
        });
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" onClick={add} disabled={pending}>
        {t.nextSteps.follow.add}
      </Button>
      {error && <ErrorNotice>{error === "cap" ? t.add.cap : t.add.error}</ErrorNotice>}
    </div>
  );
}
