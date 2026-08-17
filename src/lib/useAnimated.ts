'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Motion primitives.
 *
 * Every hook here checks `prefers-reduced-motion` and degrades to the final
 * value immediately. Motion is a garnish on this app, never the mechanism by
 * which information arrives — if a user has asked their OS to stop things
 * moving, they still get every number, instantly.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** True once the component has mounted — the trigger for entrance transitions. */
export function useMounted(delayMs = 0): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (delayMs === 0) {
      // Two frames: one to commit the "from" styles, one to flip to "to".
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
      return () => cancelAnimationFrame(raf);
    }
    const timer = setTimeout(() => setMounted(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return mounted;
}

/**
 * Counts a number up to its target.
 *
 * Money that lands with a run-up feels earned; money that blinks into place
 * feels like a page load. Uses an ease-out so most of the motion happens early
 * and the value settles rather than crawling.
 *
 * Re-targets smoothly: if the value changes mid-flight it animates from
 * wherever it currently is, so logging a sale counts up from the old total.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const fromRef = useRef(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const delta = target - from;

    if (delta === 0) return;

    // Very small changes aren't worth animating; they just look like a glitch.
    if (Math.abs(delta) < 2) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutExpo — fast start, soft landing.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = from + delta * eased;

      setValue(current);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, durationMs]);

  return value;
}

/**
 * Reveals children when they scroll into view. Content below the fold arriving
 * as you reach it is what separates a live app from a rendered document.
 */
export function useInView<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) return setInView(true);

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return setInView(true);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect(); // one-way: never fade back out on scroll up
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, inView];
}
