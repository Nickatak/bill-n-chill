"use client";

/**
 * SVG overlay that draws animated arrows from onboarding step cards
 * to their corresponding navigation elements. Desktop only — hidden
 * when the viewport is too narrow for the navbar to be visible.
 *
 * Uses document-level event delegation: any element with a
 * `data-onboarding-step` attribute automatically participates in
 * the guide arrow system on hover — no React state threading needed.
 *
 * The "organization" and "return-hint" steps are special: they open
 * the toolbar dropdown and point at the Organization menu item inside it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./guide-arrow-overlay.module.css";

/** Maps onboarding step keys to the data-onboarding-target values on nav elements. */
const STEP_TARGETS: Record<string, string> = {
  "return-hint": "get-started-item",
  organization: "organization-item",
  customer: "customers",
  project: "projects",
  estimate: "projects",
  send: "projects",
  "change-order": "projects",
  invoice: "invoices",
  bill: "bills",
  payment: "invoices",
};

/** Steps that require opening the toolbar dropdown first. */
const MENU_STEPS = new Set(["organization", "return-hint"]);

/** Minimum viewport width for arrows to render (matches navbar hide breakpoint). */
const MIN_WIDTH = 700;

type ArrowState = {
  path: string;
  pathLength: number;
} | null;

/**
 * Compute a quadratic bezier SVG path from a step card to a nav target.
 *
 * The arrow exits from the top-center of the step card and lands on
 * the content-facing edge of the target button, vertically centered:
 * - Left-side nav elements → arrow lands on right edge
 * - Right-side nav elements → arrow lands on left edge
 */
function computeArrowPath(fromRect: DOMRect, toRect: DOMRect): string {
  const startX = fromRect.left + fromRect.width / 2;
  const startY = fromRect.top;

  const targetCenterX = toRect.left + toRect.width / 2;
  const viewportMidX = window.innerWidth / 2;
  const isTargetOnRight = targetCenterX > viewportMidX;

  // Land on the content-facing edge, vertically centered.
  const endX = isTargetOnRight ? toRect.left : toRect.right;
  const endY = toRect.top + toRect.height / 2;

  // Control point: horizontally between start and end, vertically
  // pulled upward to create a natural arc above the content.
  const cpX = (startX + endX) / 2;
  const cpY = Math.min(startY, endY) - 60;

  return `M ${startX} ${startY} Q ${cpX} ${cpY} ${endX} ${endY}`;
}

export function GuideArrowOverlay() {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [arrow, setArrow] = useState<ArrowState>(null);
  const [isWide, setIsWide] = useState(false);
  const highlightedRef = useRef<Element | null>(null);
  const openedMenuRef = useRef<HTMLDetailsElement | null>(null);
  const activeStepRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);

  // Track viewport width to hide arrows on mobile.
  useEffect(() => {
    function check() {
      setIsWide(window.innerWidth > MIN_WIDTH);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Remove highlight class and close any menu we opened.
  const clearHighlight = useCallback(() => {
    if (highlightedRef.current) {
      highlightedRef.current.classList.remove(styles.targetHighlight);
      highlightedRef.current = null;
    }
    if (openedMenuRef.current) {
      openedMenuRef.current.open = false;
      openedMenuRef.current = null;
    }
  }, []);

  const showArrow = useCallback(
    (stepKey: string) => {
      if (!isWide) return;

      const targetName = STEP_TARGETS[stepKey];
      if (!targetName) return;

      const stepEl = document.querySelector(`[data-onboarding-step="${stepKey}"]`);
      if (!stepEl) return;

      activeStepRef.current = stepKey;
      const needsMenu = MENU_STEPS.has(stepKey);

      // Use rAF so we run after any cleanup from a previous arrow.
      rafRef.current = requestAnimationFrame(() => {
        if (needsMenu) {
          const menuEl = document.querySelector<HTMLDetailsElement>(
            `[data-onboarding-target="organization"]`,
          );
          if (menuEl && !menuEl.open) {
            menuEl.open = true;
            openedMenuRef.current = menuEl;
          }
        }

        // Wait another frame for the menu to lay out before measuring.
        rafRef.current = requestAnimationFrame(() => {
          // Guard against race: user may have already left the element.
          if (activeStepRef.current !== stepKey) return;

          const targetEl = document.querySelector(`[data-onboarding-target="${targetName}"]`);
          if (!targetEl) {
            setArrow(null);
            return;
          }

          const fromRect = stepEl.getBoundingClientRect();
          const toRect = targetEl.getBoundingClientRect();
          const path = computeArrowPath(fromRect, toRect);

          setArrow({ path, pathLength: 0 });

          if (highlightedRef.current) {
            highlightedRef.current.classList.remove(styles.targetHighlight);
          }
          targetEl.classList.add(styles.targetHighlight);
          highlightedRef.current = targetEl;
        });
      });
    },
    [isWide, clearHighlight],
  );

  const hideArrow = useCallback(() => {
    activeStepRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setArrow(null);
    clearHighlight();
  }, [clearHighlight]);

  // Document-level event delegation for hover on [data-onboarding-step] elements.
  // Uses mouseover/mouseout (which bubble) with relatedTarget checks to avoid
  // flickering when the mouse moves between child elements within a step card.
  useEffect(() => {
    function onOver(e: MouseEvent) {
      const el = (e.target as Element).closest?.("[data-onboarding-step]");
      if (!el) return;
      const stepKey = el.getAttribute("data-onboarding-step");
      // Only fire if we're entering a new step (skip child-to-child movement).
      if (stepKey && stepKey !== activeStepRef.current) showArrow(stepKey);
    }

    function onOut(e: MouseEvent) {
      const el = (e.target as Element).closest?.("[data-onboarding-step]");
      if (!el) return;
      // Only hide if the mouse is actually leaving the step container.
      const related = e.relatedTarget as Element | null;
      if (!related || !el.contains(related)) {
        hideArrow();
      }
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, [showArrow, hideArrow]);

  // Once the path is rendered, measure its length for the draw animation.
  useEffect(() => {
    if (arrow && pathRef.current && arrow.pathLength === 0) {
      const length = pathRef.current.getTotalLength();
      setArrow((prev) => (prev ? { ...prev, pathLength: length } : null));
    }
  }, [arrow]);

  if (!isWide || !arrow) {
    return null;
  }

  return (
    <svg ref={svgRef} className={styles.overlay} aria-hidden="true">
      <defs>
        <marker
          id="guide-arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" className={styles.arrowhead} />
        </marker>
      </defs>
      <path
        ref={pathRef}
        d={arrow.path}
        className={styles.arrowPath}
        markerEnd="url(#guide-arrowhead)"
        style={
          arrow.pathLength > 0
            ? {
                strokeDasharray: arrow.pathLength,
                strokeDashoffset: 0,
              }
            : {
                strokeDasharray: 1000,
                strokeDashoffset: 1000,
              }
        }
      />
    </svg>
  );
}
