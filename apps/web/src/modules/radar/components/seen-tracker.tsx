"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { markSuggestionsSeenAction } from "../actions";

const FLUSH_DELAY_MS = 800;

// docs/adr/0074: a suggestion counts as seen once at least half of its card was on screen while
// the page was visible. Sightings go to the server in one batch per pause, each id once per page.
export function SeenTracker({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const sent = new Set<string>();
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      timer = undefined;
      const ids = [...pending];
      pending.clear();
      if (ids.length > 0) void markSuggestionsSeenAction(ids).catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-suggestion-id");
          if (!entry.isIntersecting || !id || sent.has(id)) continue;
          sent.add(id);
          pending.add(id);
          observer.unobserve(entry.target);
        }
        if (pending.size > 0 && timer === undefined) timer = setTimeout(flush, FLUSH_DELAY_MS);
      },
      { threshold: 0.5 },
    );
    // An observer reports a card once when observed and then only on changes, so a card already
    // on screen while the tab was hidden is observed afresh when the tab comes back.
    const observeUnsent = () => {
      for (const card of element.querySelectorAll("[data-suggestion-id]")) {
        if (sent.has(card.getAttribute("data-suggestion-id") ?? "")) continue;
        observer.unobserve(card);
        observer.observe(card);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") observeUnsent();
    };
    observeUnsent();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
    };
  }, []);

  return (
    <div ref={root} className="contents">
      {children}
    </div>
  );
}
