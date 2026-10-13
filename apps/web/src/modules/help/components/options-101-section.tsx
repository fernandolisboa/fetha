import { PayoffChart, StatBlocks } from "@/modules/portfolio/client";

import { loadOptions101Examples, type Options101Example } from "../options-101";
import { t } from "../strings";

function Concept({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="text-muted-foreground text-[13px]">{body}</p>
    </div>
  );
}

function ExampleDiagram({
  title,
  body,
  example,
  spot,
}: {
  title: string;
  body: string;
  example: Options101Example;
  spot: string;
}) {
  const { pricing } = example;
  return (
    <div className="flex flex-col gap-3">
      <Concept title={title} body={body} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <PayoffChart points={pricing.payoff} spot={spot} breakEvens={pricing.breakEvens} />
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

export async function Options101Section() {
  const examples = await loadOptions101Examples();
  const spot = examples.spot;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-[72ch] text-[13px]">{t.optionsBasics.intro}</p>
        <p className="text-muted-foreground max-w-[72ch] text-[12px] italic">
          {t.optionsBasics.illustrativeNotice(examples.underlying, spot)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Concept title={t.optionsBasics.strike.title} body={t.optionsBasics.strike.body} />
        <Concept title={t.optionsBasics.expiry.title} body={t.optionsBasics.expiry.body} />
        <Concept title={t.optionsBasics.premium.title} body={t.optionsBasics.premium.body} />
      </div>

      <Concept
        title={t.optionsBasics.impliedVolatility.title}
        body={`${t.optionsBasics.impliedVolatility.body} ${t.optionsBasics.impliedVolatility.ivRank}`}
      />

      <ExampleDiagram
        title={t.optionsBasics.structures.longCall.title}
        body={t.optionsBasics.structures.longCall.body}
        example={examples.longCall}
        spot={spot}
      />
      <ExampleDiagram
        title={t.optionsBasics.structures.longPut.title}
        body={t.optionsBasics.structures.longPut.body}
        example={examples.longPut}
        spot={spot}
      />
      <ExampleDiagram
        title={t.optionsBasics.structures.bullCallSpread.title}
        body={t.optionsBasics.structures.bullCallSpread.body}
        example={examples.bullCallSpread}
        spot={spot}
      />
    </div>
  );
}
