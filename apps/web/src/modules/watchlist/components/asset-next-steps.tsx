import type { ReactNode } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { t } from "../strings";
import { AddToWatchlistButton } from "./add-to-watchlist-button";

const strings = t.nextSteps;

function Step({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <li className="border-line-soft flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-medium">{title}</h3>
      {children}
    </li>
  );
}

export function AssetNextSteps({
  ticker,
  onWatchlist,
  hasActiveStrategy,
}: {
  ticker: string;
  onWatchlist: boolean;
  hasActiveStrategy: boolean;
}) {
  const strategySentence = !hasActiveStrategy
    ? strings.strategy.none
    : onWatchlist
      ? strings.strategy.active
      : strings.strategy.notWatched;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{strings.subtitle}</p>
      <ol className="flex flex-col gap-3">
        <Step title={strings.follow.title}>
          <p className="text-[13px]">
            {onWatchlist ? strings.follow.onWatchlist : strings.follow.notOnWatchlist}
          </p>
          {!onWatchlist && <AddToWatchlistButton ticker={ticker} />}
        </Step>
        <Step title={strings.study.title}>
          <p className="text-[13px]">{strings.study.body(ticker)}</p>
          <Link
            href={`/carteira/nova-operacao?ticker=${encodeURIComponent(ticker)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
          >
            {strings.study.action}
          </Link>
        </Step>
        <Step
          title={
            <span className="flex items-center gap-2">
              {strings.recipe.title}
              <Badge variant="outline" className="text-muted-foreground text-[11px] font-normal">
                {strings.recipe.soon}
              </Badge>
            </span>
          }
        >
          <p className="text-muted-foreground text-[13px]">{strings.recipe.body}</p>
        </Step>
      </ol>
      <div className="border-line-soft flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-[13px]">{strategySentence}</p>
        <Link
          href="/estrategias"
          className="text-primary w-fit text-[13px] underline-offset-4 hover:underline"
        >
          {strings.strategy.action}
        </Link>
      </div>
    </div>
  );
}
