import Link from "next/link";

import { Panel } from "@/modules/shell/client";

import { guideSections } from "../guide-sections";
import { t } from "../strings";

function StepList({ steps, ordered = false }: { steps: string[]; ordered?: boolean }) {
  if (ordered) {
    return (
      <ol className="flex max-w-[72ch] flex-col gap-2 text-[13px]">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2.5">
            <span className="text-muted-foreground w-4 shrink-0 text-right font-mono tabular-nums">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul className="marker:text-muted-foreground flex max-w-[72ch] list-disc flex-col gap-1.5 pl-4 text-[13px]">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ul>
  );
}

export function HowToUseGuide() {
  return (
    <div className="grid items-start gap-[14px] lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-[14px]">
        {guideSections().map((section) => (
          <Panel key={section.href} title={section.label} subtitle={section.summary}>
            <StepList steps={section.steps} />
            <Link
              href={section.href}
              className="text-primary inline-flex min-h-8 items-center self-start text-[13px] underline-offset-4 hover:underline"
            >
              {t.guide.open(section.label)}
            </Link>
          </Panel>
        ))}
      </div>

      <div className="flex flex-col gap-[14px] lg:sticky lg:top-4">
        <Panel title={t.guide.flow.title}>
          <StepList steps={t.guide.flow.steps} ordered />
        </Panel>
        <Panel title={t.guide.header.title}>
          <StepList steps={t.guide.header.steps} />
        </Panel>
        <Panel title={t.guide.principles.title}>
          <StepList steps={t.guide.principles.steps} />
        </Panel>
      </div>
    </div>
  );
}
