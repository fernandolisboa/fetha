import type { LessonBlock } from "@fetha/contracts";

import { PayoffChart, StatBlocks } from "@/modules/portfolio/client";

import type { IllustrativeExampleId, IllustrativeExamples } from "../illustrative-market";
import { resolveText } from "../placeholders";

function Callout({ tone, text }: { tone: "info" | "warning"; text: string }) {
  return (
    <div
      className={
        tone === "warning"
          ? "border-warning/40 bg-warning/10 rounded-[var(--radius)] border px-3 py-2.5 text-[13px]"
          : "border-line-soft bg-secondary/40 rounded-[var(--radius)] border px-3 py-2.5 text-[13px]"
      }
    >
      {text}
    </div>
  );
}

function PayoffExampleBlock({
  exampleId,
  caption,
  examples,
}: {
  exampleId: IllustrativeExampleId;
  caption: string;
  examples: IllustrativeExamples;
}) {
  const pricing = examples[exampleId];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground max-w-[72ch] text-[13px]">{caption}</p>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <PayoffChart points={pricing.payoff} spot={examples.spot} breakEvens={pricing.breakEvens} />
        <StatBlocks
          netPremium={pricing.netPremium}
          maxLoss={pricing.maxLoss}
          maxGain={pricing.maxGain}
          breakEvens={pricing.breakEvens}
        />
      </div>
    </div>
  );
}

export function LessonBlocks({
  blocks,
  examples,
}: {
  blocks: readonly LessonBlock[];
  examples: IllustrativeExamples;
}) {
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {blocks.map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <p key={index} className="text-[13px] leading-relaxed">
              {resolveText(block.text.pt, examples)}
            </p>
          );
        }
        if (block.type === "list") {
          return (
            <ul
              key={index}
              className="marker:text-muted-foreground list-disc flex-col gap-1.5 pl-4 text-[13px]"
            >
              {block.items.pt.map((item, itemIndex) => (
                <li key={itemIndex} className="py-0.5">
                  {resolveText(item, examples)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "callout") {
          return (
            <Callout key={index} tone={block.tone} text={resolveText(block.text.pt, examples)} />
          );
        }
        return (
          <PayoffExampleBlock
            key={index}
            exampleId={block.exampleId as IllustrativeExampleId}
            caption={resolveText(block.caption.pt, examples)}
            examples={examples}
          />
        );
      })}
    </div>
  );
}
