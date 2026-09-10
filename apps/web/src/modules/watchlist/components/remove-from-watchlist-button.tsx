"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { removeFromWatchlistAction } from "../actions";
import { t } from "../strings";

export function RemoveFromWatchlistButton({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  function remove() {
    setError(false);
    setPending(true);
    startTransition(() => {
      removeFromWatchlistAction({ ticker })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.refresh();
          } else {
            setError(true);
          }
        })
        .catch(() => {
          setPending(false);
          setError(true);
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={remove}
        disabled={pending}
        aria-label={`${t.remove.action} ${ticker}`}
      >
        <X aria-hidden />
      </Button>
      {error && <p className="text-destructive text-xs">{t.remove.error}</p>}
    </div>
  );
}
