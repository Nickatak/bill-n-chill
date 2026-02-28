/**
 * Horizontal workflow navbar showing the numbered workflow steps.
 *
 * Renders one link per step from `workflowRoutes`. The "Billing" step
 * is special-cased as a dropdown button that opens a floating menu with
 * sub-links for Invoices and Bills. The floating menu is manually
 * positioned relative to the trigger button to avoid clipping issues
 * inside the scrollable nav container.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isRouteActive, workflowRoutes } from "../nav-routes";
import styles from "./workflow-navbar.module.css";
import toolbar from "../app-toolbar/app-toolbar.module.css";

/**
 * Render the primary workflow step navbar.
 *
 * Each step maps to a `NavRoute` from `workflowRoutes`. Routes with
 * `kind: "billing_menu"` render a dropdown instead of a plain link so
 * users can choose between Invoices and Bills. When inside a project
 * context, the Bills link preserves the `?project=` param.
 */
export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";
  const pathProjectMatch = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  const projectId = pathProjectMatch?.[1] ?? null;

  // Billing dropdown state
  const billingButtonRef = useRef<HTMLButtonElement>(null);
  const billingMenuRef = useRef<HTMLDivElement>(null);
  const [billingMenuOpenPathname, setBillingMenuOpenPathname] = useState<string | null>(null);
  const isBillingOpen = billingMenuOpenPathname === pathname;
  const [billingMenuPosition, setBillingMenuPosition] = useState({ top: 0, left: 0 });

  // Active-state flags for billing sub-routes
  const isInvoicesPath = pathname === "/invoices";
  const isBillsPath = pathname === "/bills";
  const isBillingPath = isInvoicesPath || isBillsPath;

  /**
   * Recalculate the floating billing menu position relative to its
   * trigger button, clamped to stay within the viewport.
   */
  function updateBillingMenuPosition() {
    const button = billingButtonRef.current;
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    const menuWidth = 220;
    const viewportPadding = 12;
    const nextLeft = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding),
    );
    setBillingMenuPosition({
      top: Math.round(rect.bottom + 6),
      left: Math.round(nextLeft),
    });
  }

  // Close the billing dropdown when the user clicks outside of it.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        billingButtonRef.current?.contains(target) ||
        billingMenuRef.current?.contains(target)
      ) {
        return;
      }
      setBillingMenuOpenPathname(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Reposition the floating billing menu on resize/scroll so it stays
  // anchored to the trigger button even when the page layout shifts.
  useEffect(() => {
    if (!isBillingOpen) {
      return;
    }

    updateBillingMenuPosition();
    function handleWindowChange() {
      updateBillingMenuPosition();
    }

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [isBillingOpen]);

  /** Close the billing dropdown after a sub-link is clicked. */
  function closeBillingMenu() {
    setBillingMenuOpenPathname(null);
  }

  return (
    <nav className={styles.nav} aria-label="MVP workflow order">
      <div className={styles.inner}>
        <div className={styles.scroll}>
          {workflowRoutes.map((route) => {
            if (route.kind === "billing_menu") {
              const billsHref = projectId
                ? `/bills?project=${encodeURIComponent(projectId)}`
                : "/bills";
              return (
                <div key={route.href} className={styles.dropdownMenu}>
                  <button
                    type="button"
                    ref={billingButtonRef}
                    className={`${styles.link} ${styles.dropdownSummary} ${
                      isBillingPath ? styles.linkActive : ""
                    }`}
                    aria-haspopup="menu"
                    aria-expanded={isBillingOpen}
                    onClick={() =>
                      setBillingMenuOpenPathname((current) =>
                        current === pathname ? null : pathname,
                      )
                    }
                  >
                    {route.label}
                  </button>
                  {isBillingOpen ? (
                    <div
                      ref={billingMenuRef}
                      className={`${toolbar.menuList} ${styles.dropdownList} ${styles.dropdownListFloating}`}
                      role="menu"
                      aria-label="Billing routes"
                      style={{
                        top: `${billingMenuPosition.top}px`,
                        left: `${billingMenuPosition.left}px`,
                      }}
                    >
                      <Link
                        href="/invoices"
                        className={`${toolbar.menuItem} ${isInvoicesPath ? toolbar.menuItemActive : ""}`}
                        role="menuitem"
                        onClick={closeBillingMenu}
                      >
                        Invoices
                      </Link>
                      <Link
                        href={billsHref}
                        className={`${toolbar.menuItem} ${isBillsPath ? toolbar.menuItemActive : ""}`}
                        role="menuitem"
                        onClick={closeBillingMenu}
                      >
                        Bills
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            }

            const isActive = isRouteActive(pathname, route);
            return (
              <Link
                key={route.href}
                href={route.href}
                className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
              >
                {route.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
