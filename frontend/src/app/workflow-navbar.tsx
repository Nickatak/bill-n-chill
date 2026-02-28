"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isRouteActive, workflowRoutes } from "./nav-routes";

export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";
  const pathProjectMatch = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  const projectId = pathProjectMatch?.[1] ?? null;
  const billingButtonRef = useRef<HTMLButtonElement>(null);
  const billingMenuRef = useRef<HTMLDivElement>(null);
  const [isBillingOpen, setIsBillingOpen] = useState(false);
  const [billingMenuPosition, setBillingMenuPosition] = useState({ top: 0, left: 0 });
  const isInvoicesPath = pathname === "/invoices";
  const isBillsPath = pathname === "/bills";
  const isBillingPath = isInvoicesPath || isBillsPath;

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

  useEffect(() => {
    setIsBillingOpen(false);
  }, [pathname]);

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
      setIsBillingOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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

  function closeBillingMenu() {
    setIsBillingOpen(false);
  }

  return (
    <nav className="workflowNav" aria-label="MVP workflow order">
      <div className="workflowNavInner">
        <div className="workflowNavScroll">
          {workflowRoutes.map((route) => {
            if (route.href === "/billing") {
              const billsHref = projectId
                ? `/bills?project=${encodeURIComponent(projectId)}`
                : "/bills";
              return (
                <div key={route.href} className="workflowDropdownMenu">
                  <button
                    type="button"
                    ref={billingButtonRef}
                    className={`workflowLink workflowDropdownSummary ${
                      isBillingPath ? "isActive" : ""
                    }`}
                    aria-haspopup="menu"
                    aria-expanded={isBillingOpen}
                    onClick={() => setIsBillingOpen((current) => !current)}
                  >
                    {route.label}
                  </button>
                  {isBillingOpen ? (
                    <div
                      ref={billingMenuRef}
                      className="nonWorkflowList workflowDropdownList workflowDropdownListFloating"
                      role="menu"
                      aria-label="Billing routes"
                      style={{
                        top: `${billingMenuPosition.top}px`,
                        left: `${billingMenuPosition.left}px`,
                      }}
                    >
                      <Link
                        href="/invoices"
                        className={`nonWorkflowItem ${isInvoicesPath ? "isActive" : ""}`}
                        role="menuitem"
                        onClick={closeBillingMenu}
                      >
                        Invoices
                      </Link>
                      <Link
                        href={billsHref}
                        className={`nonWorkflowItem ${isBillsPath ? "isActive" : ""}`}
                        role="menuitem"
                        onClick={closeBillingMenu}
                      >
                        Bills (WIP)
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
                className={`workflowLink ${isActive ? "isActive" : ""}`}
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
