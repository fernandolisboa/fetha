import { NextResponse } from "next/server";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  isProductionDeployment,
  readE2ESecret,
  requireUser,
  UnauthenticatedError,
} from "@/modules/auth";
import { seedE2EResearch, type SeedE2EResearchIdea } from "@/modules/decisions";
import { getSuggestion, seedE2ERadar } from "@/modules/radar";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

const UNDERLYING = tickerSchema.parse("PETR4");
const MODEL = "claude-opus-5-5";

// E2E-only, same guard as `/api/e2e/seed-radar`: the CI owner has no Anthropic key, so this
// stores a research the way an accepted answer leaves it (docs/adr/0076), one idea under each
// verdict, all of the lot the seeded radar suggestion prices, at the radar's newest close.
export async function POST(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }
  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const seeded = await seedE2ERadar(getDb(), UNDERLYING);
  if (!seeded.ok) {
    return seeded.reason === "e2e_not_available"
      ? new NextResponse(null, { status: 404 })
      : NextResponse.json({ error: "no ingested close for PETR4" }, { status: 409 });
  }
  const suggestion = seeded.suggestionId ? await getSuggestion(seeded.suggestionId) : null;
  if (!suggestion?.reading) {
    return NextResponse.json({ error: "the engine could not price the spread" }, { status: 409 });
  }

  const idea = (
    verdict: SeedE2EResearchIdea["verdict"],
    justification: string,
    aiAlerts: SeedE2EResearchIdea["aiAlerts"],
  ): SeedE2EResearchIdea => ({
    underlying: suggestion.underlying,
    recipeId: suggestion.recipeId,
    foundOn: suggestion.session,
    suggestionId: suggestion.id,
    sessionsToExpiry: 20,
    legs: suggestion.legs,
    pricing: suggestion.pricing,
    reading: suggestion.reading as NonNullable<typeof suggestion.reading>,
    engineAlerts: [],
    verdict,
    justification,
    aiAlerts,
    claim: suggestion.claim,
    horizon: suggestion.horizon,
  });

  const result = await seedE2EResearch(getDb(), user, {
    research: {
      newestClose: suggestion.session,
      sessionsLooked: 3,
      candidates: 16,
      dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
      usingDefaultProfile: true,
    },
    model: MODEL,
    overview: "Pesquisa semeada pelo fluxo de ponta a ponta, com uma ideia em cada veredito.",
    ideas: [
      idea("enter", "A trava cabe no perfil e o risco está todo na perda máxima.", []),
      idea("wait", "Vale esperar um fechamento mais claro antes de montar.", ["weak_track_record"]),
      idea("do_not_enter", "A tendência está contra e a liquidez é baixa.", [
        "trend_against",
        "low_liquidity",
      ]),
    ],
  });
  if (!result.ok) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ researchId: result.researchId }, { status: 201 });
}
