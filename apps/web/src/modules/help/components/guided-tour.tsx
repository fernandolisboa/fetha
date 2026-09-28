"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dismissTourAction } from "@/modules/preferences/client";

import { t } from "../strings";
import { tourSteps, type TourStep } from "../tour-steps";

interface TourControls {
  start: () => void;
}

const TourContext = createContext<TourControls | null>(null);

const SPOTLIGHT_PADDING = 4;

// Lets the first screen after sign-in finish its redirect and paint before
// the tour dims it.
const AUTO_START_DELAY_MS = 600;

// A target counts only when it takes up space and fits the viewport's width
// (scrollIntoView handles the vertical axis): the rail is display:none under
// 768px, the header's account menu can sit past the right edge on a phone,
// and a step whose element is missing (the watchlist's add button on another
// page) falls back to a centered card whose buttons stay reachable.
function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const element = document.querySelector<HTMLElement>(step.target);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const visible =
    rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth;
  return visible ? element : null;
}

function viewportCenter() {
  return {
    getBoundingClientRect: () =>
      new DOMRect(window.innerWidth / 2, window.innerHeight / 2 - 120, 0, 0),
  };
}

function useTargetRect(target: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!target) return;
    const update = () => {
      setRect(target.getBoundingClientRect());
    };
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(target);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target]);

  return target ? rect : null;
}

function Spotlight({ rect }: { rect: DOMRect | null }) {
  return createPortal(
    <div aria-hidden className="fixed inset-0 z-40">
      {rect ? (
        <div
          className="absolute rounded-[var(--radius)] shadow-[0_0_0_9999px_rgb(0_0_0/0.6)] ring-1 ring-[var(--accent)] transition-[top,left,width,height] duration-[180ms] ease-in-out motion-reduce:transition-none"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}
    </div>,
    document.body,
  );
}

function TourCard({
  index,
  onBack,
  onNext,
  onClose,
}: {
  index: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const step = tourSteps[index];
  const nextRef = useRef<HTMLButtonElement>(null);
  // Replay navigates to the watchlist and starts at once; looking again when
  // the route lands finds targets that only exist there.
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const rect = useTargetRect(target);

  useEffect(() => {
    if (!step) return;
    const frame = requestAnimationFrame(() => {
      const found = findTarget(step);
      found?.scrollIntoView({ block: "nearest" });
      setTarget(found);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [step, pathname]);

  if (!step) return null;

  const copy = t.tour.steps[step.id];
  const isLast = index === tourSteps.length - 1;
  const anchored = target !== null && rect !== null;

  return (
    <>
      <Spotlight rect={anchored ? rect : null} />
      <Popover
        open
        modal
        onOpenChange={(open, details) => {
          if (!open && (details.reason === "escape-key" || details.reason === "close-press")) {
            onClose();
          }
        }}
      >
        <PopoverContent
          anchor={anchored ? target : viewportCenter()}
          side={anchored ? step.side : "bottom"}
          sideOffset={anchored ? 12 : 0}
          collisionPadding={16}
          initialFocus={nextRef}
          data-tour-card=""
          className="w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-[var(--radius)] p-4"
        >
          <p aria-hidden className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {t.tour.progress(index + 1, tourSteps.length)}
          </p>
          <div className="flex flex-col gap-1">
            <PopoverTitle className="text-[15px] font-semibold">{copy.title}</PopoverTitle>
            <PopoverDescription className="text-[13px]">
              <span className="sr-only">{t.tour.progress(index + 1, tourSteps.length)}. </span>
              {copy.body}
            </PopoverDescription>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {isLast ? null : (
              <PopoverClose render={<Button type="button" variant="ghost" size="sm" />}>
                {t.tour.skip}
              </PopoverClose>
            )}
            <div className="ml-auto flex gap-2">
              {index > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={onBack}>
                  {t.tour.back}
                </Button>
              ) : null}
              {isLast ? (
                <PopoverClose render={<Button type="button" size="sm" ref={nextRef} />}>
                  {t.tour.finish}
                </PopoverClose>
              ) : (
                <Button type="button" size="sm" ref={nextRef} onClick={onNext}>
                  {t.tour.next}
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export function TourProvider({ autoStart, children }: { autoStart: boolean; children: ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!autoStart) return;
    const timer = setTimeout(() => {
      setIndex(0);
    }, AUTO_START_DELAY_MS);
    // A user already clicking or typing keeps what they started; the modal
    // card would steal focus and close an open combobox. It shows next load.
    const cancel = () => {
      clearTimeout(timer);
    };
    window.addEventListener("pointerdown", cancel, { once: true, capture: true });
    window.addEventListener("keydown", cancel, { once: true, capture: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", cancel, { capture: true });
      window.removeEventListener("keydown", cancel, { capture: true });
    };
  }, [autoStart]);

  const start = useCallback(() => {
    setIndex(0);
  }, []);

  const close = useCallback(() => {
    setIndex(null);
    void dismissTourAction().catch(() => undefined);
  }, []);

  const controls = useMemo(() => ({ start }), [start]);

  return (
    <TourContext value={controls}>
      {children}
      {index !== null ? (
        <TourCard
          key={index}
          index={index}
          onBack={() => {
            setIndex(Math.max(0, index - 1));
          }}
          onNext={() => {
            setIndex(Math.min(tourSteps.length - 1, index + 1));
          }}
          onClose={close}
        />
      ) : null}
    </TourContext>
  );
}

export function ReplayTourButton({ className }: { className?: string }) {
  const controls = use(TourContext);
  const router = useRouter();

  if (!controls) return null;

  return (
    <Button
      type="button"
      variant="outline"
      className={cn(className)}
      onClick={() => {
        router.push("/");
        controls.start();
      }}
    >
      {t.tour.replay}
    </Button>
  );
}
