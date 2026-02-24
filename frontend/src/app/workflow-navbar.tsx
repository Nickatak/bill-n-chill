"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isRouteActive, workflowRoutes } from "./nav-routes";

export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";
  const pathProjectMatch = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  const projectId = pathProjectMatch?.[1] ?? null;
  const postApprovalButtonRef = useRef<HTMLButtonElement>(null);
  const postApprovalMenuRef = useRef<HTMLDivElement>(null);
  const [isPostApprovalOpen, setIsPostApprovalOpen] = useState(false);
  const [postApprovalMenuPosition, setPostApprovalMenuPosition] = useState({ top: 0, left: 0 });
  const isChangeOrdersPath =
    pathname === "/change-orders" || /^\/projects\/\d+\/change-orders$/.test(pathname);
  const isInvoicesPath = pathname === "/invoices";
  const isVendorBillsPath = /^\/projects\/\d+\/vendor-bills$/.test(pathname);
  const isPostApprovalPath = isChangeOrdersPath || isInvoicesPath || isVendorBillsPath;

  function updatePostApprovalMenuPosition() {
    const button = postApprovalButtonRef.current;
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
    setPostApprovalMenuPosition({
      top: Math.round(rect.bottom + 6),
      left: Math.round(nextLeft),
    });
  }

  useEffect(() => {
    setIsPostApprovalOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        postApprovalButtonRef.current?.contains(target) ||
        postApprovalMenuRef.current?.contains(target)
      ) {
        return;
      }
      setIsPostApprovalOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!isPostApprovalOpen) {
      return;
    }

    updatePostApprovalMenuPosition();
    function handleWindowChange() {
      updatePostApprovalMenuPosition();
    }

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [isPostApprovalOpen]);

  function closePostApprovalMenu() {
    setIsPostApprovalOpen(false);
  }

  return (
    <nav className="workflowNav" aria-label="MVP workflow order">
      <div className="workflowNavInner">
        <div className="workflowNavScroll">
          {workflowRoutes.map((route) => {
            if (route.href === "/post-approval") {
              const changeOrdersHref = projectId
                ? `/projects/${encodeURIComponent(projectId)}/change-orders`
                : "/change-orders";
              const vendorBillsHref = projectId
                ? `/projects/${encodeURIComponent(projectId)}/vendor-bills`
                : "/projects";
              return (
                <div key={route.href} className="workflowDropdownMenu">
                  <button
                    type="button"
                    ref={postApprovalButtonRef}
                    className={`workflowLink workflowDropdownSummary ${
                      isPostApprovalPath ? "isActive" : ""
                    }`}
                    aria-haspopup="menu"
                    aria-expanded={isPostApprovalOpen}
                    onClick={() => setIsPostApprovalOpen((current) => !current)}
                  >
                    {route.label}
                  </button>
                  {isPostApprovalOpen ? (
                    <div
                      ref={postApprovalMenuRef}
                      className="nonWorkflowList workflowDropdownList workflowDropdownListFloating"
                      role="menu"
                      aria-label="Changes and billing routes"
                      style={{
                        top: `${postApprovalMenuPosition.top}px`,
                        left: `${postApprovalMenuPosition.left}px`,
                      }}
                    >
                      <Link
                        href={changeOrdersHref}
                        className={`nonWorkflowItem ${isChangeOrdersPath ? "isActive" : ""}`}
                        role="menuitem"
                        onClick={closePostApprovalMenu}
                      >
                        Change Orders
                      </Link>
                      <Link
                        href="/invoices"
                        className={`nonWorkflowItem ${isInvoicesPath ? "isActive" : ""}`}
                        role="menuitem"
                        onClick={closePostApprovalMenu}
                      >
                        Invoices
                      </Link>
                      <Link
                        href={vendorBillsHref}
                        className={`nonWorkflowItem ${isVendorBillsPath ? "isActive" : ""}`}
                        role="menuitem"
                        onClick={closePostApprovalMenu}
                      >
                        Vendor Bills
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
