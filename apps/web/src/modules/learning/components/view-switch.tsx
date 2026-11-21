"use client";

import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { t } from "../strings";

export type LessonsView = "jornada" | "temas";

export function ViewSwitch({ view }: { view: LessonsView }) {
  const router = useRouter();

  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        router.push(value === "temas" ? "/aprender?ver=temas" : "/aprender");
      }}
    >
      <TabsList variant="line" aria-label={t.viewBy.label}>
        <TabsTrigger value="jornada">{t.viewBy.jornada}</TabsTrigger>
        <TabsTrigger value="temas">{t.viewBy.temas}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
