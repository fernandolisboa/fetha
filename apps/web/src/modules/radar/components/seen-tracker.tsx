"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { markSuggestionsSeenAction } from "../actions";
import { countsAsSeen, SEEN_THRESHOLDS } from "../seen";

const FLUSH_DELAY_MS = 800;

// docs/adr/0074: a suggestion counts as seen once enough of its card was on screen while the page
// was visible. Sightings go to the server in one batch per pause; a failed batch is retried the
// next time its cards come on screen.
export function SeenTracker({ ids, children }: { ids: readonly string[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const sent = useRef(new Set<string>());
  // The same tracker stays mounted when the list grows (watchlist tab to radar tab), so the
  // cards are observed again whenever the rendered ids change.
  const idsKey = ids.join(",");

  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const pending = new Set<string>();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cards = () => [...element.querySelectorAll("[data-suggestion-id]")];
    const observeUnsent = () => {
      for (const card of cards()) {
        if (sent.current.has(card.getAttribute("data-suggestion-id") ?? "")) continue;
        observer.unobserve(card);
        observer.observe(card);
      }
    };

    const flush = () => {
      timer = undefined;
      const batch = [...pending];
      pending.clear();
      if (batch.length === 0) return;
      void markSuggestionsSeenAction(batch)
        .then((result) => result.status === "ok")
        .catch(() => false)
        .then((ok) => {
          if (ok || disposed) return;
          for (const id of batch) sent.current.delete(id);
          observeUnsent();
        });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-suggestion-id");
          if (!id || sent.current.has(id)) continue;
          const seen = countsAsSeen({
            intersectionRatio: entry.intersectionRatio,
            intersectionHeight: entry.intersectionRect.height,
            viewportHeight: entry.rootBounds?.height ?? null,
          });
          if (!seen) continue;
          sent.current.add(id);
          pending.add(id);
          observer.unobserve(entry.target);
        }
        if (pending.size > 0 && timer === undefined) timer = setTimeout(flush, FLUSH_DELAY_MS);
      },
      { threshold: SEEN_THRESHOLDS },
    );
    // An observer reports a card once when observed and then only as it crosses a threshold, so
    // a card already on screen while the tab was hidden is observed afresh when it comes back.
    const onVisibility = () => {
      if (document.visibilityState === "visible") observeUnsent();
    };
    observeUnsent();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [idsKey]);

  return (
    <div ref={root} className="contents">
      {children}
    </div>
  );
}
