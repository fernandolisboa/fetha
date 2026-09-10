"use client";

import { useRouter } from "next/navigation";
import type { CandleForm } from "@fetha/engine";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "../strings";

export function CandleFormToggle({ ticker, form }: { ticker: string; form: CandleForm }) {
  const router = useRouter();

  return (
    <Tabs
      value={form}
      onValueChange={(value) => {
        router.push(`/ativos/${ticker}?form=${String(value)}`);
      }}
    >
      <TabsList variant="line">
        <TabsTrigger value="adjusted">{t.instrument.adjusted}</TabsTrigger>
        <TabsTrigger value="nominal">{t.instrument.nominal}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
