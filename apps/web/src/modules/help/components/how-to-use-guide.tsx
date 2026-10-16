import Link from "next/link";

import { Panel } from "@/modules/shell/client";

import { guideSections } from "../guide-sections";
import { t } from "../strings";
import { Options101Section } from "./options-101-section";

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

// Two fixed stacks rather than CSS columns: a multi-column flow rebalances every panel when one
// grows, so text moves under the reader.
function sectionColumns() {
  const sections = guideSections();
  const half = Math.ceil(sections.length / 2);
  return [sections.slice(0, half), sections.slice(half)];
}

export function HowToUseGuide() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid items-start gap-[14px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="@container">
          <div className="grid items-start gap-[14px] @min-[64rem]:grid-cols-2">
            {sectionColumns().map((column, index) => (
              <div key={index} className="flex min-w-0 flex-col gap-[14px]">
                {column.map((section) => (
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
            ))}
          </div>
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

      <Panel title={t.optionsBasics.title}>
        <Options101Section />
      </Panel>
    </div>
  );
}
