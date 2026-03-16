"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";

export interface UseCreatorFlashReturn<T extends HTMLElement = HTMLDivElement> {
  /** Ref to attach to the element that should flash. */
  ref: RefObject<T | null>;
  /** Call to trigger the flash animation. */
  flash: () => void;
}

/**
 * Encapsulates the creator sheet flash animation pattern.
 *
 * Removes the flash class, forces a reflow, re-adds it, and cleans up
 * on animationend. Returns a ref for the target element and a stable
 * `flash()` trigger function.
 */
export function useCreatorFlash<T extends HTMLElement = HTMLDivElement>(): UseCreatorFlashReturn<T> {
  const ref = useRef<T | null>(null);
  const [count, setCount] = useState(0);

  const flash = useCallback(() => {
    setCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (count === 0) return;
    const el = ref.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [count]);

  return { ref, flash };
}
