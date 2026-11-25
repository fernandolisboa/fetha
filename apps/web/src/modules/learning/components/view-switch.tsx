"use client";

import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { t } from "../strings";

export type LessonsView = "jornada" | "temas" | "estruturas";

const VIEW_PATH: Record<LessonsView, string> = {
  jornada: "/aprender",
  temas: "/aprender?ver=temas",
  estruturas: "/aprender?ver=estruturas",
};

export function ViewSwitch({ view }: { view: LessonsView }) {
  const router = useRouter();

  return (
    <Tabs
      value={view}
      onValueChange={(value: string) => {
        const next: LessonsView = value === "temas" || value === "estruturas" ? value : "jornada";
        router.push(VIEW_PATH[next]);
      }}
    >
      <TabsList variant="line" aria-label={t.viewBy.label}>
        <TabsTrigger value="jornada">{t.viewBy.jornada}</TabsTrigger>
        <TabsTrigger value="temas">{t.viewBy.temas}</TabsTrigger>
        <TabsTrigger value="estruturas">{t.viewBy.estruturas}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
